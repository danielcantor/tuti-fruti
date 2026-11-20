import { getState } from "@/lib/engine";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pid = url.searchParams.get("pid");
  const v = url.searchParams.get("v");
  try {
    const state = await getState(pid, v === null || v === "" ? null : Number(v));
    return Response.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "No se pudo leer el juego" }, { status: 500 });
  }
}
