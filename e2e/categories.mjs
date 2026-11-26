// El dueño elige las categorías. Uso: NODE_PATH="$(npm root -g)" node e2e/categories.mjs [url] [carpeta-capturas]
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
const chip = (p, label) => p.getByRole("group", { name: "Categorías" }).getByRole("button", { name: label, exact: true });
const pressed = async (p, label) => (await chip(p, label).getAttribute("aria-pressed")) === "true";

await join(a, "Ana");
await join(b, "Beto");
await sleep(2500);
check(await pressed(a, "Nombre") && !(await pressed(a, "Animal")), "arranca con las 5 de siempre");
check(await chip(b, "Animal").isDisabled(), "Beto no puede cambiarlas");

// Ana cambia: saca Serie, Color y Marca; suma Animal y Excusa para llegar tarde
for (const l of ["Animal", "Excusa para llegar tarde", "Serie / Película", "Color", "Marca"]) {
  await chip(a, l).click();
  await sleep(700);
}
await sleep(2500);
check(await pressed(b, "Excusa para llegar tarde") && !(await pressed(b, "Marca")), "Beto ve la elección de Ana");
check((await a.textContent("main")).includes("Se juegan siempre estas (4)"), "muestra cuántas hay elegidas");
await a.screenshot({ path: `${OUT}/cat-1-sala-desktop.png`, fullPage: true });
await b.screenshot({ path: `${OUT}/cat-1-sala-mobile.png`, fullPage: true });

await a.getByRole("button", { name: "Girar la ruleta" }).click();
await sleep(6500);
const L = (await a.locator(".animate-pop").textContent()).trim();
const inputs = a.locator("form input");
check((await inputs.count()) === 4, "el formulario tiene las 4 categorías elegidas");
const labels = await a.locator("form label > span").allInnerTexts();
check(labels.some((t) => t.startsWith("Excusa para llegar tarde")), "aparece la categoría nueva");
for (let i = 0; i < 4; i++) await inputs.nth(i).fill(`${L}ola ${i}`);
await b.locator("form input").nth(0).fill(`${L}beto`);
await sleep(800);
await b.screenshot({ path: `${OUT}/cat-2-jugando-mobile.png`, fullPage: true });
await a.getByRole("button", { name: "¡Basta!", exact: true }).click();
await a.getByText(`Revisión de la letra ${L}`).waitFor({ timeout: 15000 });
await sleep(1200);
const heads = (await a.locator("thead th").allInnerTexts()).map((t) => t.trim().toLowerCase());
check(heads.includes("animal") && !heads.includes("marca"), "la revisión muestra solo las elegidas");
await a.screenshot({ path: `${OUT}/cat-3-revision-desktop.png`, fullPage: true });
await a.getByRole("button", { name: "Sumar puntos y volver a la ruleta" }).click();
await sleep(1800);
check(!(await a.getByRole("group", { name: "Categorías" }).count()), "después de la primera ronda ya no se cambian");
await browser.close();
console.log("listo");
