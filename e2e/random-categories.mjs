// Categorías al azar en cada ronda. Uso: NODE_PATH="$(npm root -g)" node e2e/random-categories.mjs [url] [carpeta-capturas]
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
for (const p of [a, b]) p.on("pageerror", (e) => console.log("pageerror:", e.message));

async function join(page, name) {
  await page.goto(URL);
  await page.getByPlaceholder("Tu nombre").fill(name);
  await page.getByRole("button", { name: "Entrar a jugar" }).click();
  await page.getByText("Jugás como").waitFor();
}
const labelsOf = async (p) =>
  (await p.locator("form label > span").allInnerTexts()).map((t) => t.split("\n")[0].trim());

await join(a, "Ana");
await join(b, "Beto");
await sleep(1500);

await a.getByRole("radio", { name: "Al azar cada ronda" }).click();
await sleep(1500);
check((await b.textContent("main")).includes("Cada ronda se sortean 5 de estas 13"), "al pasar a azar arranca con las 13 y 5 por ronda");
await a.getByRole("radiogroup", { name: "Categorías por ronda" }).getByRole("radio", { name: "3" }).click();
await sleep(1500);
check((await b.textContent("main")).includes("Cada ronda se sortean 3 de estas 13"), "Beto ve que se sortean 3");
await a.screenshot({ path: `${OUT}/azar-1-sala-desktop.png`, fullPage: true });
await b.screenshot({ path: `${OUT}/azar-1-sala-mobile.png`, fullPage: true });

const rounds = [];
for (let r = 0; r < 2; r++) {
  const spinner = r === 0 ? a : b;
  await spinner.getByRole("button", { name: "Girar la ruleta" }).click();
  await sleep(6500);
  const la = await labelsOf(a);
  const lb = await labelsOf(b);
  check(la.length === 3 && la.join() === lb.join(), `ronda ${r + 1}: los dos tienen las mismas 3 (${la.join(", ")})`);
  rounds.push(la.join());
  if (r === 0) await b.screenshot({ path: `${OUT}/azar-2-jugando-mobile.png`, fullPage: true });
  const L = (await a.locator(".animate-pop").textContent()).trim();
  for (let i = 0; i < 3; i++) await a.locator("form input").nth(i).fill(`${L}ola ${i}`);
  await a.getByRole("button", { name: "¡Basta!", exact: true }).click();
  await a.getByText(`Revisión de la letra ${L}`).waitFor({ timeout: 15000 });
  await sleep(1000);
  await a.getByRole("button", { name: "Sumar puntos y volver a la ruleta" }).click();
  await sleep(1800);
}
check((await a.textContent("main")).includes("3 categorías al azar por ronda"), "la sala recuerda que es al azar");
console.log("rondas:", rounds);
await browser.close();
console.log("listo");
