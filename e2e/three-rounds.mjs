// Partida a 3 rondas con dos jugadores hasta la pantalla del ganador.
// Uso: NODE_PATH="$(npm root -g)" node e2e/three-rounds.mjs [url] [carpeta-capturas]
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
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true });
const a = await ctxA.newPage();
const b = await ctxB.newPage();
for (const p of [a, b]) p.on("pageerror", (e) => console.log("pageerror:", e.message));

async function join(page, name) {
  await page.goto(URL);
  await page.getByPlaceholder("Tu nombre").fill(name);
  await page.getByRole("button", { name: "Entrar a jugar" }).click();
  await page.getByText("Jugás como").waitFor();
}

await join(a, "Ana");
await join(b, "Beto");
check(await b.getByText("Le toca girar a Ana").isVisible(), "Beto ve que le toca girar a Ana");
check(await a.getByText("dueño de la sala").isVisible(), "Ana es la dueña de la sala");
check(await b.getByRole("radio", { name: "3 rondas" }).isDisabled(), "Beto no puede elegir las rondas");
await a.getByRole("radio", { name: "3 rondas" }).click();
await sleep(2500);
check((await b.getByRole("radio", { name: "3 rondas" }).getAttribute("aria-checked")) === "true", "Beto ve elegidas 3 rondas");
await a.screenshot({ path: `${OUT}/r-1-selector.png` });

for (let r = 1; r <= 3; r++) {
  // El turno rota: Ana, Beto, Ana
  const spinner = r % 2 === 1 ? a : b;
  await spinner.getByText(r === 1 ? "Girar la ruleta" : "¡Te toca girar!").first().waitFor({ timeout: 5000 });
  check(true, `ronda ${r}: le toca girar a ${r % 2 === 1 ? "Ana" : "Beto"}`);
  await spinner.getByRole("button", { name: "Girar la ruleta" }).click();
  await sleep(5500);
  const L = (await a.locator(".animate-pop").textContent()).trim();
  check((await a.textContent("header")).includes(`Ronda ${r} de 3`), `encabezado "Ronda ${r} de 3"`);
  if (r === 1) {
    check(/\d:\d\d/.test(await a.locator('[title="Tiempo que queda de la ronda"]').textContent()), "se ve el reloj de la ronda");
    await a.screenshot({ path: `${OUT}/r-2-jugando.png` });
  }
  const inputs = a.locator("form input");
  for (let i = 0; i < 5; i++) await inputs.nth(i).fill(`${L}ola${r}${i}`);
  // Beto completa solo un casillero: los otros 4 cuentan como vacíos.
  await b.locator("form input").first().fill(`${L}beto${r}`);
  await sleep(900);
  await a.getByRole("button", { name: "¡Basta!", exact: true }).click();
  await a.getByText(`Revisión de la letra ${L}`).waitFor({ timeout: 15000 });
  await sleep(800);
  if (r === 1) check(await b.getByText("Esperando que Ana sume los puntos").isVisible(), "Beto espera a la dueña para sumar");
  await a.getByRole("button", { name: "Sumar puntos y volver a la ruleta" }).click();
  await sleep(1500);
}

await a.getByText("¡Ganó Ana!").waitFor({ timeout: 5000 });
await b.getByText("¡Ganó Ana!").waitFor({ timeout: 5000 });
check(true, "los dos ven la pantalla del ganador");
check((await a.textContent("main")).includes("150"), "Ana suma 150 (3 rondas × 50)");
check(await a.getByText("Los premios de la partida").isVisible(), "se ven los premios");
check(await a.getByText("La más larga").isVisible(), "premio a la palabra más larga");
check(await a.getByText("Letra más difícil").isVisible(), "premio a la letra más difícil");
check(
  await a.locator("li", { hasText: "Más casilleros vacíos" }).filter({ hasText: "Beto" }).isVisible(),
  "premio a más casilleros vacíos para Beto",
);
await a.screenshot({ path: `${OUT}/r-3-ganador-desktop.png` });
await b.screenshot({ path: `${OUT}/r-3-ganador-mobile.png`, fullPage: true });

check(await b.getByText("Esperando que Ana empiece otra partida").isVisible(), "solo la dueña reinicia");
await a.getByRole("button", { name: "Jugar otra partida" }).click();
await a.getByRole("button", { name: "Girar la ruleta" }).waitFor({ timeout: 5000 });
check(true, "\"Jugar otra partida\" vuelve a la ruleta");

await browser.close();
console.log("TODO OK");
