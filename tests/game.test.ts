import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_MS,
  ROUND_MS,
  SPIN_MS,
  STOP_MS,
  derivePhase,
  initialGame,
  invalidKey,
  normalize,
  pickLetter,
  scoreRound,
  totals,
  winners,
} from "@/lib/game";
import { computeAwards } from "@/lib/awards";
import { act, getState } from "@/lib/engine";
import { createMemoryStore, getStore, hashFromReply, setStore } from "@/lib/store";

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

describe("límite de rondas y cortes automáticos", () => {
  const A = "aaaaaaaa-1111";
  const B = "bbbbbbbb-2222";
  const T0 = 2_000_000;
  beforeEach(() => {
    setStore(createMemoryStore());
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  const full = async (playerId: string) => {
    const st = await getState(playerId, null);
    if ("same" in st) throw new Error();
    const L = st.game.letter!;
    return { nombre: L + "a", serie: L + "b", lugar: L + "c", color: L + "d", marca: L + "e" };
  };

  async function playRound() {
    await act({ type: "spin", playerId: A });
    vi.advanceTimersByTime(400 + SPIN_MS);
    await act({ type: "basta", playerId: A, answers: await full(A) });
    vi.advanceTimersByTime(STOP_MS);
    await act({ type: "closeRound", playerId: B });
  }

  it("partida a 3 rondas termina sola y no deja girar más", async () => {
    await act({ type: "join", playerId: A, name: "Ana" });
    await act({ type: "join", playerId: B, name: "Beto" });
    await expect(act({ type: "setMaxRounds", playerId: A, value: 4 })).rejects.toThrow();
    await act({ type: "setMaxRounds", playerId: B, value: 3 });
    await playRound();
    await expect(act({ type: "setMaxRounds", playerId: A, value: 5 })).rejects.toThrow();
    await playRound();
    await playRound();
    const st = await getState(A, null);
    if ("same" in st) throw new Error();
    expect(st.game.phase).toBe("finished");
    expect(st.game.maxRounds).toBe(3);
    await expect(act({ type: "spin", playerId: A })).rejects.toThrow("terminó");
    expect(winners(st.totals)).toEqual([A]);
    await act({ type: "reset", playerId: A });
    const again = await getState(A, null);
    if ("same" in again) throw new Error();
    expect(again.game.phase).toBe("lobby");
    expect(again.game.maxRounds).toBe(3);
  });

  it("a los 3 minutos sin ¡Basta! la ronda se corta sola", async () => {
    await act({ type: "join", playerId: A, name: "Ana" });
    await act({ type: "spin", playerId: A });
    vi.advanceTimersByTime(400 + SPIN_MS + ROUND_MS - 1);
    let st = await getState(A, null);
    if ("same" in st) throw new Error();
    expect(st.game.phase).toBe("playing");
    vi.advanceTimersByTime(1);
    st = await getState(A, null);
    if ("same" in st) throw new Error();
    expect(st.game.phase).toBe("stopping");
    // Cantar ¡Basta! tarde guarda las respuestas pero no cambia quién cortó.
    await act({ type: "basta", playerId: A, answers: await full(A) });
    const after = await getState(A, null);
    if ("same" in after) throw new Error();
    expect(after.game.bastaBy).toBeNull();
    await act({ type: "answer", playerId: A, answers: { nombre: st.game.letter + "x" } });
    vi.advanceTimersByTime(STOP_MS + 1000);
    await act({ type: "answer", playerId: A, answers: { nombre: st.game.letter + "y" } }); // margen de gracia
    st = await getState(A, null);
    if ("same" in st) throw new Error();
    expect(st.game.phase).toBe("review");
    expect(st.answers[A].nombre).toBe(st.game.letter + "y");
  });

  it("partida sin límite termina a los 15 minutos sin girar", async () => {
    await act({ type: "join", playerId: A, name: "Ana" });
    await act({ type: "join", playerId: B, name: "Beto" });
    await playRound();
    vi.advanceTimersByTime(IDLE_MS - 1);
    let st = await getState(A, null);
    if ("same" in st) throw new Error();
    expect(st.game.phase).toBe("lobby");
    vi.advanceTimersByTime(1);
    st = await getState(A, null);
    if ("same" in st) throw new Error();
    expect(st.game.phase).toBe("finished");
  });

  it("winners maneja empates y vacío", () => {
    expect(winners({ a: 30, b: 30, c: 10 })).toEqual(["a", "b"]);
    expect(winners({})).toEqual([]);
  });
});

describe("computeAwards", () => {
  it("arma la repetida, la rara, la larga, la corta y los premios por jugador", () => {
    const e = { nombre: "", serie: "", lugar: "", color: "", marca: "" };
    const results = [
      {
        round: 1,
        letter: "R",
        points: {
          a: { nombre: 5, color: 5, lugar: 10, marca: 0 },
          b: { nombre: 5, color: 5, serie: 10 },
        },
        answers: {
          a: { ...e, nombre: "Rosa", color: "Rojo", lugar: "Rosario de la Frontera", marca: "Rxyz" },
          b: { ...e, nombre: "rosa", color: "rojo", serie: "Rick" },
        },
        invalid: ["a|marca"],
        bastaBy: "a",
      },
      {
        round: 2,
        letter: "R",
        points: { a: { color: 5 }, b: { color: 5 } },
        answers: { a: { ...e, color: "Rojo" }, b: { ...e, color: "Rojo" } },
        invalid: [],
        bastaBy: null,
      },
    ];
    const aw = Object.fromEntries(computeAwards(results).map((x) => [x.key, x]));
    expect(aw.common.value).toBe("Rojo");
    expect(aw.common.detail).toContain("4 veces");
    expect(aw.rare.value).toBe("Rick"); // k: letra rarísima, dicha una sola vez
    expect(aw.long.value).toBe("Rosario de la Frontera");
    expect(aw.short.value).toBe("Rosa");
    expect(aw.original.playerIds.sort()).toEqual(["a", "b"]);
    expect(aw.fast.playerIds).toEqual(["a"]);
    expect(aw.annulled.playerIds).toEqual(["a"]);
    expect(aw.hard.value).toBeTruthy();
    // a: 1 vacío (serie) en ronda 1 + 4 en ronda 2 = 5; b: 2 + 4 = 6
    expect(aw.empty.playerIds).toEqual(["b"]);
    expect(aw.empty.value).toBe("6 casilleros vacíos");
  });

  it("casilleros vacíos: empate nombra a todos y sin vacíos no hay premio", () => {
    const full = { nombre: "Ana", serie: "Avatar", lugar: "Asia", color: "Azul", marca: "Adidas" };
    const pts = { nombre: 10, serie: 10, lugar: 10, color: 10, marca: 10 };
    const tie = computeAwards([
      {
        round: 1,
        letter: "A",
        points: { a: pts, b: pts },
        answers: { a: { ...full, color: "" }, b: { ...full, marca: "" } },
      },
    ]);
    const empty = tie.find((x) => x.key === "empty")!;
    expect(empty.playerIds.sort()).toEqual(["a", "b"]);
    expect(empty.value).toBe("1 casillero vacío");
    const none = computeAwards([{ round: 1, letter: "A", points: { a: pts }, answers: { a: full } }]);
    expect(none.some((x) => x.key === "empty")).toBe(false);
  });

  it("letra más difícil: la ronda con más casilleros en cero", () => {
    const e = { nombre: "", serie: "", lugar: "", color: "", marca: "" };
    const all10 = { nombre: 10, serie: 10, lugar: 10, color: 10, marca: 10 };
    const res = [
      { round: 1, letter: "A", points: { a: all10 }, answers: { a: { ...e, nombre: "Ana" } } },
      { round: 2, letter: "Z", points: { a: { nombre: 10 } }, answers: { a: { ...e, nombre: "Zoe" } } },
    ];
    const letter = computeAwards(res).find((x) => x.key === "letter")!;
    expect(letter.value).toBe("Z");
    expect(letter.detail).toBe("4 de 5 casilleros sin puntos");
    // Con una sola ronda no hay con qué comparar
    expect(computeAwards(res.slice(0, 1)).some((x) => x.key === "letter")).toBe(false);
  });

  it("partidas viejas sin respuestas guardadas no rompen", () => {
    expect(computeAwards([{ round: 1, letter: "A", points: { a: { nombre: 10 } } }])).toEqual([]);
  });
});

describe("chat", () => {
  const A = "aaaaaaaa-1111";
  beforeEach(() => setStore(createMemoryStore()));

  it("valida, recorta y guarda solo los últimos 100", async () => {
    await expect(act({ type: "chat", playerId: A, text: "hola" })).rejects.toThrow("entrá");
    await act({ type: "join", playerId: A, name: "Ana" });
    await expect(act({ type: "chat", playerId: A, text: "   " })).rejects.toThrow();
    await act({ type: "chat", playerId: A, text: "  hola   che  " });
    await act({ type: "chat", playerId: A, text: "x".repeat(300) });
    let st = await getState(A, null);
    if ("same" in st) throw new Error();
    expect(st.chat.map((m) => m.text.length)).toEqual([8, 200]);
    expect(st.chat[0]).toMatchObject({ text: "hola che", name: "Ana", playerId: A });

    for (let i = 0; i < 120; i++) await act({ type: "chat", playerId: A, text: `m${i}` });
    st = await getState(A, null);
    if ("same" in st) throw new Error();
    expect(st.chat).toHaveLength(50); // se mandan los últimos 50
    expect(st.chat[49].text).toBe("m119"); // el más nuevo al final
    expect(await getStore().lrange("tf:chat", 0, -1)).toHaveLength(100);
  });

  it("se puede escribir durante la ronda y Nueva partida no lo borra", async () => {
    await act({ type: "join", playerId: A, name: "Ana" });
    await act({ type: "spin", playerId: A });
    await act({ type: "chat", playerId: A, text: "¡vamos!" });
    await act({ type: "reset", playerId: A });
    const st = await getState(A, null);
    if ("same" in st) throw new Error();
    expect(st.chat.map((m) => m.text)).toEqual(["¡vamos!"]);
  });
});
