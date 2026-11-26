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

const card = (p) => p.locator(`li[data-vote$="|color"]`);
// Beto cuestiona el color de Ana
await b.getByRole("button", { name: new RegExp(`^${L}olorcito`) }).click();
await card(a).waitFor({ timeout: 5000 });
check((await card(a).textContent()).includes("Anulada"), "con un voto en contra, queda anulada");
check((await card(a).textContent()).includes("Es tu respuesta"), "Ana no puede votar la suya");
check((await card(c).textContent()).includes("Faltan") && (await card(c).textContent()).includes("Caro"), "se ve que le falta votar a Caro");
await a.screenshot({ path: `${OUT}/votos-1-anulada-desktop.png`, fullPage: true });

// Caro dice que vale: empate, queda
await card(c).getByRole("button", { name: "Vale", exact: true }).click();
await sleep(1800);
const txt = await card(a).textContent();
check(txt.includes("Vale (1)") && txt.includes("No vale (1)") && txt.includes("Caro") && txt.includes("Beto"), "se ve quién votó qué");
check(!(await a.locator("td .line-through", { hasText: `${L}olorcito` }).count()), "con empate la respuesta vale");
await b.screenshot({ path: `${OUT}/votos-2-empate-mobile.png`, fullPage: true });
await c.screenshot({ path: `${OUT}/votos-2-empate-tablet.png`, fullPage: true });

// Caro cambia a "no vale": 2 a 0
await card(c).getByRole("button", { name: "No vale" }).click();
await sleep(1800);
check((await card(a).textContent()).includes("Anulada"), "al cambiar el voto vuelve a quedar anulada");

await a.getByRole("button", { name: "Sumar puntos y volver a la ruleta" }).click();
await sleep(1800);
check(!(await a.getByText("Votaciones").count()), "al cerrar la ronda se terminan las votaciones");
await browser.close();
console.log("listo");
