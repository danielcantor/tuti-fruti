import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SPIN_MS,
  STOP_MS,
  derivePhase,
  initialGame,
  invalidKey,
  normalize,
  pickLetter,
  scoreRound,
  totals,
} from "@/lib/game";
import { act, getState } from "@/lib/engine";
import { createMemoryStore, hashFromReply, setStore } from "@/lib/store";

describe("normalize", () => {
  it("saca acentos, mayúsculas y espacios pero conserva la ñ", () => {
    expect(normalize("  Ñandú   Cañón ")).toBe("ñandu cañon");
    expect(normalize("Matías")).toBe("matias");
    expect(normalize("Coca-Cola")).toBe("coca cola");
  });
});

describe("scoreRound", () => {
  const base = { nombre: "", serie: "", lugar: "", color: "", marca: "" };
  it("10 única, 5 repetida, 0 vacía o con otra letra", () => {
    const pts = scoreRound(
      "M",
      {
        a: { ...base, nombre: "Martín", lugar: "Mendoza", color: "Marrón" },
        b: { ...base, nombre: "martin ", lugar: "Madrid", color: "Rojo" },
      },
      new Set(),
    );
    expect(pts.a).toMatchObject({ nombre: 5, lugar: 10, color: 10, serie: 0, marca: 0 });
    expect(pts.b).toMatchObject({ nombre: 5, lugar: 10, color: 0 });
  });

  it("las inválidas valen 0 y no cuentan como repetidas", () => {
    const pts = scoreRound(
      "S",
      { a: { ...base, marca: "Sony" }, b: { ...base, marca: "sony" } },
      new Set([invalidKey("b", "marca")]),
    );
    expect(pts.a.marca).toBe(10);
    expect(pts.b.marca).toBe(0);
  });

  it("totals suma todas las rondas", () => {
    expect(
      totals([
        { round: 1, letter: "A", points: { a: { nombre: 10, color: 5 } } },
        { round: 2, letter: "B", points: { a: { nombre: 10 }, b: { lugar: 5 } } },
      ]),
    ).toEqual({ a: 25, b: 5 });
  });
});

describe("fases y letras", () => {
  it("el giro y la cuenta regresiva terminan solos", () => {
    const g = { ...initialGame(), status: "spinning" as const, spinAt: 1000 };
    expect(derivePhase(g, 1000 + SPIN_MS - 1)).toBe("spinning");
    expect(derivePhase(g, 1000 + SPIN_MS)).toBe("playing");
    const s = { ...g, status: "stopping" as const, bastaAt: 5000 };
    expect(derivePhase(s, 5000 + STOP_MS - 1)).toBe("stopping");
    expect(derivePhase(s, 5000 + STOP_MS)).toBe("review");
  });

  it("no repite letras hasta agotarlas", () => {
    let used: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 21; i++) {
      const r = pickLetter(used);
      expect(seen.has(r.letter)).toBe(false);
      seen.add(r.letter);
      used = r.used;
    }
    expect(pickLetter(used).used).toHaveLength(1);
  });
});

describe("partida completa", () => {
  const A = "aaaaaaaa-1111";
  const B = "bbbbbbbb-2222";
  beforeEach(() => {
    setStore(createMemoryStore());
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  it("dos jugadores: girar, ¡basta!, revisar y cerrar", async () => {
    await act({ type: "join", playerId: A, name: "Ana" });
    await act({ type: "join", playerId: B, name: "Beto" });
    await act({ type: "spin", playerId: A });
    await expect(act({ type: "spin", playerId: B })).rejects.toThrow();

    vi.setSystemTime(1_000_000 + 400 + SPIN_MS);
    const st = await getState(A, null);
    if ("same" in st) throw new Error("esperaba estado completo");
    expect(st.game.phase).toBe("playing");
    const L = st.game.letter!;
    const full = (x: string) => ({ nombre: L + x, serie: L + x, lugar: L + x, color: L + x, marca: L + x });

    await act({ type: "answer", playerId: B, answers: { nombre: L + "a" } });
    // Ana todavía no ve las de Beto
    const mid = await getState(A, null);
    if ("same" in mid) throw new Error();
    expect(Object.keys(mid.answers)).toEqual([]);

    await expect(act({ type: "basta", playerId: A, answers: { nombre: L } })).rejects.toThrow();
    await act({ type: "basta", playerId: A, answers: full("a") });
    await act({ type: "answer", playerId: B, answers: { ...full("a"), color: L + "b" } });

    vi.advanceTimersByTime(STOP_MS);
    const rev = await getState(B, null);
    if ("same" in rev) throw new Error();
    expect(rev.game.phase).toBe("review");
    expect(rev.preview![A]).toMatchObject({ nombre: 5, color: 10 });

    await act({ type: "toggleInvalid", playerId: B, target: A, cat: "color" });
    await act({ type: "closeRound", playerId: B });
    const end = await getState(A, null);
    if ("same" in end) throw new Error();
    expect(end.game.phase).toBe("lobby");
    expect(end.totals[A]).toBe(20); // 4x5 + color inválido
    expect(end.totals[B]).toBe(30); // 4x5 + color único

    const same = await getState(A, end.ver);
    expect("same" in same).toBe(true);
    vi.useRealTimers();
  });
});

describe("hashFromReply", () => {
  it("convierte la lista plana de Upstash en objeto", () => {
    expect(hashFromReply(["id-1", '{"name":"Vale"}', "id-2", '{"name":"Dani"}'])).toEqual({
      "id-1": '{"name":"Vale"}',
      "id-2": '{"name":"Dani"}',
    });
    expect(hashFromReply(null)).toEqual({});
    expect(hashFromReply({ a: { name: "x" } })).toEqual({ a: '{"name":"x"}' });
  });
});
