// Chat entre dos jugadores. Uso: NODE_PATH="$(npm root -g)" node e2e/chat.mjs [url] [carpeta-capturas]
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
const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const b = await (
  await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true })
).newPage();
for (const p of [a, b]) p.on("pageerror", (e) => console.log("pageerror:", e.message));

async function join(page, name) {
  await page.goto(URL);
  await page.getByPlaceholder("Tu nombre").fill(name);
  await page.getByRole("button", { name: "Entrar a jugar" }).click();
  await page.getByText("Jugás como").waitFor();
}
await join(a, "Ana");
await join(b, "Beto");

const openChat = (p) => p.getByRole("button", { name: /^Abrir chat/ }).click();
const say = async (p, text) => {
  await p.getByLabel("Mensaje").fill(text);
  await p.getByRole("button", { name: "Enviar" }).click();
};

await openChat(a);
await say(a, "¡Hola! ¿Arrancamos?");
await sleep(2500);
check((await b.getByTestId("chat-unread").textContent()) === "1", "Beto ve 1 mensaje sin leer");

await openChat(b);
check(await b.getByText("¡Hola! ¿Arrancamos?").isVisible(), "Beto lee el mensaje de Ana");
check((await b.getByTestId("chat-unread").count()) === 0, "al abrir, el contador desaparece");
await say(b, "Dale, girá");
await sleep(2500);
check(await a.getByText("Dale, girá").isVisible(), "Ana ve la respuesta de Beto");
await a.screenshot({ path: `${OUT}/chat-desktop.png` });
await b.screenshot({ path: `${OUT}/chat-mobile.png` });

// Durante la ronda también se puede escribir
await b.getByRole("button", { name: "Cerrar chat" }).first().click();
await a.getByRole("button", { name: "Girar la ruleta" }).click();
await sleep(5500);
await say(a, "Esta letra es difícil");
await sleep(1800);
check((await b.getByTestId("chat-unread").textContent()) === "1", "mensaje durante la ronda llega como no leído");

await browser.close();
console.log("TODO OK");
