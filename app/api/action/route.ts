import { GameError, act } from "@/lib/engine";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Pedido inválido" }, { status: 400 });
  }
  try {
    await act(body);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Algo falló, probá de nuevo" }, { status: 500 });
  }
}
