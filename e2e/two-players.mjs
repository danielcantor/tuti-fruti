// Prueba de punta a punta con dos jugadores. Uso: node e2e/two-players.mjs [url] [carpeta-capturas]
import { createRequire } from "node:module";
// Playwright viene instalado globalmente en el entorno (NODE_PATH="$(npm root -g)").
const { chromium } = createRequire(import.meta.url)("playwright");

const URL = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, msg) => {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("ok -", msg);
};

const browser = await chromium.launch();
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true });
const a = await ctxA.newPage();
const b = await ctxB.newPage();
for (const p of [a, b]) p.on("pageerror", (e) => console.log("pageerror:", e.message));

async function join(page, name) {
  await page.goto(URL);
  await page.getByPlaceholder("Tu nombre").fill(name);
  await page.getByRole("button", { name: "Entrar a jugar" }).click();
  await page.getByRole("button", { name: "Girar la ruleta" }).waitFor();
}

await join(a, "Ana");
await a.screenshot({ path: `${OUT}/1-lobby-desktop.png` });
await join(b, "Beto");
await sleep(1500);
check((await a.textContent("body")).includes("Beto"), "Ana ve a Beto en la sala");

await a.getByRole("button", { name: "Girar la ruleta" }).click();
await sleep(1500);
await b.screenshot({ path: `${OUT}/2-girando-mobile.png` });
check((await b.textContent("body")).includes("Girando"), "Beto ve la ruleta girando");
await sleep(4500);

const letterA = (await a.locator(".animate-pop").textContent()).trim();
const letterB = (await b.locator(".animate-pop").textContent()).trim();
check(letterA === letterB && /^[A-Z]$/.test(letterA), `los dos tienen la misma letra (${letterA})`);
const L = letterA;

const inputs = (p) => p.locator("form input");
const fill = async (p, vals) => {
  for (let i = 0; i < vals.length; i++) await inputs(p).nth(i).fill(vals[i]);
};
await fill(a, [`${L}ana`, `${L}serie`, `${L}lugar`, `${L}color`, `${L}marca`]);
await fill(b, [`${L}ANA`, `${L}otra serie`, "", `${L}color beto`, "Zzz"]);
await a.screenshot({ path: `${OUT}/3-jugando-desktop.png` });
await b.screenshot({ path: `${OUT}/3-jugando-mobile.png` });
check(await b.getByText(`No empieza con ${L}`).isVisible() || L === "Z", "avisa cuando no empieza con la letra");

await a.getByRole("button", { name: "¡Basta!", exact: true }).click();
await sleep(1500);
check((await b.textContent("body")).includes("cantó Ana"), "Beto ve que Ana cantó ¡Basta!");
await b.screenshot({ path: `${OUT}/4-basta-mobile.png` });
await b.locator("form input").nth(2).fill(`${L}lugar`);
await sleep(10000);

await a.getByText(`Revisión de la letra ${L}`).waitFor({ timeout: 8000 });
await b.getByText(`Revisión de la letra ${L}`).waitFor({ timeout: 8000 });
await sleep(1200);
check(true, "los dos llegan a la revisión");
await a.screenshot({ path: `${OUT}/5-revision-desktop.png`, fullPage: true });
await b.screenshot({ path: `${OUT}/5-revision-mobile.png`, fullPage: true });

// Beto anula el color de Ana
await b.getByRole("button", { name: new RegExp(`^${L}color\\s*10$`) }).click();
await sleep(1800);
check(await a.locator("td .line-through", { hasText: `${L}color` }).count() === 1, "Ana ve su color anulado");

await a.getByRole("button", { name: "Sumar puntos y volver a la ruleta" }).click();
await sleep(1800);
const board = (p) => p.locator("aside li").allInnerTexts();
const rowsA = await board(a);
console.log("tabla:", rowsA.map((r) => r.replace(/\s+/g, " ")));
// Ana: nombre 5 (repetido), serie 10, lugar 5 (Beto lo puso tarde), color 0 (anulado), marca 10 = 30
// Beto: nombre 5, serie 10, lugar 5, color 10, marca 0 = 30
const pts = Object.fromEntries(rowsA.map((r) => { const t = r.split(/\s+/); return [t[1], Number(t[t.length - 1])]; }));
check(pts.Ana === 30 && pts.Beto === 30, "puntajes: Ana 30, Beto 30");
check(await b.getByRole("button", { name: "Girar la ruleta" }).isVisible(), "vuelven a la ruleta");
await a.screenshot({ path: `${OUT}/6-tabla-desktop.png` });

await browser.close();
console.log("TODO OK");
