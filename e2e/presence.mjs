// Avisos de entrada y salida. Uso: NODE_PATH="$(npm root -g)" node e2e/presence.mjs [url] [carpeta-capturas]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const URL = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? ".";
const check = (cond, msg) => {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("ok -", msg);
};

const browser = await chromium.launch();
const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const b = await ctxB.newPage();

async function join(page, name) {
  await page.goto(URL);
  await page.getByPlaceholder("Tu nombre").fill(name);
  await page.getByRole("button", { name: "Entrar a jugar" }).click();
  await page.getByRole("button", { name: "Girar la ruleta" }).waitFor();
}

await join(a, "Ana");
await join(b, "Beto");
await a.getByTestId("notice").filter({ hasText: "Beto entró a la sala" }).waitFor({ timeout: 5000 });
check(true, "Ana ve el aviso: Beto entró a la sala");
await a.screenshot({ path: `${OUT}/presence-entro.png` });
check((await a.textContent("main")).includes("En la sala: Ana, Beto"), "la sala muestra a los dos conectados");

const t0 = Date.now();
await ctxB.close(); // Beto cierra el navegador
await a.getByTestId("notice").filter({ hasText: "Beto se fue" }).waitFor({ timeout: 60000 });
check(true, `Ana ve el aviso: Beto se fue (a los ${Math.round((Date.now() - t0) / 1000)} s)`);
await a.screenshot({ path: `${OUT}/presence-se-fue.png` });
check((await a.textContent("main")).includes("En la sala: Ana."), "Beto ya no figura en la sala");

await a.getByRole("button", { name: /^Abrir chat/ }).click();
check(await a.getByText("se fue").last().isVisible(), "el aviso queda también en el chat");

await browser.close();
console.log("TODO OK");
