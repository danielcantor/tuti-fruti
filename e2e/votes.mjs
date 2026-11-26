// Votación de respuestas con tres jugadores. Uso: NODE_PATH="$(npm root -g)" node e2e/votes.mjs [url] [carpeta-capturas]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const URL = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, msg) => {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("ok -", msg);
};

const browser = await chromium.launch();
const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" })).newPage();
const b = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, colorScheme: "dark" })).newPage();
const c = await (await browser.newContext({ viewport: { width: 1024, height: 800 } })).newPage();
for (const p of [a, b, c]) p.on("pageerror", (e) => console.log("pageerror:", e.message));

async function join(page, name) {
  await page.goto(URL);
  await page.getByPlaceholder("Tu nombre").fill(name);
  await page.getByRole("button", { name: "Entrar a jugar" }).click();
  await page.getByText("Jugás como").waitFor();
}

await join(a, "Ana");
await join(b, "Beto");
await join(c, "Caro");
await sleep(1500);
await a.getByRole("button", { name: "Girar la ruleta" }).click();
await sleep(6500);
const L = (await a.locator(".animate-pop").textContent()).trim();

const fill = async (p, vals) => {
  for (let i = 0; i < vals.length; i++) await p.locator("form input").nth(i).fill(vals[i]);
};
await fill(a, [`${L}ana`, `${L}serie`, `${L}lugar`, `${L}olorcito`, `${L}marca`]);
await fill(b, [`${L}beto`, `${L}serie b`, `${L}lugar b`, `${L}color b`, `${L}marca b`]);
await fill(c, [`${L}caro`, `${L}serie c`, `${L}lugar c`, `${L}color c`, `${L}marca c`]);
await sleep(800);
await a.getByRole("button", { name: "¡Basta!", exact: true }).click();
for (const p of [a, b, c]) await p.getByText(`Revisión de la letra ${L}`).waitFor({ timeout: 15000 });
await sleep(1200);

const card = (p, cat = "color") => p.locator(`li[data-vote$="|${cat}"]`);
const closeBtn = () => a.getByRole("button", { name: "Sumar puntos y volver a la ruleta" });

check((await b.getByTestId("mark-window").textContent()).includes("Podés marcar palabras durante"), "al empezar la revisión se pueden marcar palabras");
// Beto cuestiona el color de Ana
await b.getByRole("button", { name: new RegExp(`^${L}olorcito`) }).click();
await card(a).waitFor({ timeout: 5000 });
let txt = await card(a).textContent();
check(txt.includes("Por ahora no vale"), "con un voto en contra, por ahora no vale");
check(!txt.includes("Beto"), "el voto es anónimo: no dice quién votó");
check(txt.includes("Faltan votar 1 persona"), "muestra que falta votar una persona");
check(/Quedan \d+ s/.test(txt), "muestra la cuenta regresiva");
check(txt.includes("Es tu respuesta"), "Ana no puede votar la suya");
check(await closeBtn().isDisabled(), "con una votación abierta no se puede pasar de ronda");
await a.screenshot({ path: `${OUT}/votos-1-abierta-desktop.png`, fullPage: true });
await c.screenshot({ path: `${OUT}/votos-1-abierta-tablet.png`, fullPage: true });

// Caro dice que vale: ya votaron todos, empate, queda
await card(c).getByRole("button", { name: "Vale", exact: true }).click();
await sleep(1800);
txt = await card(a).textContent();
check(txt.includes("Votación cerrada") && txt.includes("ya votaron todos"), "se cierra cuando votaron todos");
check(!txt.includes("Caro") && !txt.includes("Beto"), "sigue sin decir quién votó");
check(!(await a.locator("td .line-through", { hasText: `${L}olorcito` }).count()), "con empate la respuesta vale");

// Caro cuestiona el lugar de Beto y nadie más vota: se cierra sola a los 20 s
await c.getByRole("button", { name: new RegExp(`^${L}lugar b`) }).click();
await card(a, "lugar").waitFor({ timeout: 5000 });
await sleep(1500);
check(await closeBtn().isDisabled(), "otra votación abierta vuelve a bloquear el pase de ronda");
await b.screenshot({ path: `${OUT}/votos-2-abierta-mobile.png`, fullPage: true });
await card(a, "lugar").getByText("Votación cerrada").waitFor({ timeout: 25000 });
check((await card(a, "lugar").textContent()).includes("Anulada"), "a los 20 s se cierra con el resultado que tenga");
check(await closeBtn().isEnabled(), "sin votaciones abiertas se puede pasar de ronda");
check((await c.getByTestId("mark-window").textContent()).includes("Ya no se pueden marcar"), "después de 20 s ya no se pueden marcar palabras");
check(await c.getByRole("button", { name: new RegExp(`^${L}color b`) }).isDisabled(), "las palabras sin votación quedan bloqueadas");
await a.screenshot({ path: `${OUT}/votos-3-cerradas-desktop.png`, fullPage: true });

await closeBtn().click();
await sleep(1800);
check(!(await a.getByText("Votaciones").count()), "al cerrar la ronda se terminan las votaciones");
await browser.close();
console.log("listo");
