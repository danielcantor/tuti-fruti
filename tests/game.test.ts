import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_MS,
  ROUND_MS,
  SPIN_MS,
  STOP_MS,
  VOTE_MS,
  answerProblem,
  cleanCategories,
  derivePhase,
  roomRoles,
  initialGame,
  invalidFromVotes,
  invalidKey,
  normalize,
  parseVotes,
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
    const w = (x: string) => L + "ola" + x;
    const full = (x: string) => ({ nombre: w(x), serie: w(x), lugar: w(x), color: w(x), marca: w(x) });

    await act({ type: "answer", playerId: B, answers: { nombre: L + "a" } });
    // Ana todavía no ve las de Beto
    const mid = await getState(A, null);
    if ("same" in mid) throw new Error();
    expect(Object.keys(mid.answers)).toEqual([]);

    await expect(act({ type: "basta", playerId: A, answers: { nombre: L } })).rejects.toThrow();
    await act({ type: "basta", playerId: A, answers: full("a") });
    await act({ type: "answer", playerId: B, answers: { ...full("a"), color: w("b") } });

    vi.advanceTimersByTime(STOP_MS);
    const rev = await getState(B, null);
    if ("same" in rev) throw new Error();
    expect(rev.game.phase).toBe("review");
    expect(rev.preview![A]).toMatchObject({ nombre: 5, color: 10 });

    await act({ type: "vote", playerId: B, target: A, cat: "color", value: "no" });
    await expect(act({ type: "closeRound", playerId: B })).rejects.toThrow("dueño");
    await act({ type: "closeRound", playerId: A });
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

describe("votación de respuestas", () => {
  it("invalidFromVotes: mayoría anula, empate queda, el autor y los que se fueron no cuentan", () => {
    expect(invalidFromVotes({ "a|color": { b: false } })).toEqual(["a|color"]);
    expect(invalidFromVotes({ "a|color": { b: false, c: true } })).toEqual([]);
    expect(invalidFromVotes({ "a|color": { b: false, c: false, d: true } })).toEqual(["a|color"]);
    expect(invalidFromVotes({ "a|color": { a: true, b: false } })).toEqual(["a|color"]);
    expect(invalidFromVotes({ "a|color": { b: false, c: true, d: true } }, new Set(["b", "c"]))).toEqual([]);
    expect(invalidFromVotes({ "a|color": { b: false } }, new Set(["a", "c"]))).toEqual([]);
  });

  it("parseVotes arma votante por respuesta e ignora basura", () => {
    expect(parseVotes({ "a|color|b": "no", "a|color|c": "si", "x|y": "no", "a|lugar|b": "quizás" })).toEqual({
      "a|color": { b: false, c: true },
    });
  });

  it("tres jugadores: voto anónimo, 20 s para votar y no se cierra la ronda con votaciones abiertas", async () => {
    setStore(createMemoryStore());
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const [A, B, C] = ["aaaaaaaa-1111", "bbbbbbbb-2222", "cccccccc-3333"];
    await act({ type: "join", playerId: A, name: "Ana" });
    await act({ type: "join", playerId: B, name: "Beto" });
    await act({ type: "join", playerId: C, name: "Caro" });
    await act({ type: "spin", playerId: A });
    vi.advanceTimersByTime(400 + SPIN_MS);
    const st = await getState(A, null);
    if ("same" in st) throw new Error();
    const L = st.game.letter!;
    const full = (x: string) => ({
      nombre: L + "ana" + x,
      serie: L + "ola" + x,
      lugar: L + "ola" + x,
      color: L + "ojo" + x,
      marca: L + "ola" + x,
    });
    await act({ type: "basta", playerId: A, answers: full("a") });
    await act({ type: "answer", playerId: B, answers: full("b") });
    await act({ type: "answer", playerId: C, answers: full("c") });

    const vote = (playerId: string, target: string, cat: "color" | "lugar" | "serie", value: "si" | "no" | null) =>
      act({ type: "vote", playerId, target, cat, value });
    await expect(vote(B, A, "color", "no")).rejects.toThrow("revisión");
    vi.advanceTimersByTime(STOP_MS);

    const view = async (who: string) => {
      const s = await getState(who, null);
      if ("same" in s) throw new Error();
      return s;
    };
    await expect(vote(A, A, "color", "no")).rejects.toThrow("propia");
    await expect(vote(B, A, "color", "si")).rejects.toThrow("Nadie cuestionó");

    // Beto cuestiona: Caro ve los totales, no quién votó.
    await vote(B, A, "color", "no");
    let s = await view(C);
    expect(s.votes[`${A}|color`]).toMatchObject({ no: 1, yes: 0, mine: null, pending: 1, done: false });
    expect(JSON.stringify(s.votes)).not.toContain(B);
    expect((await view(B)).votes[`${A}|color`].mine).toBe("no");
    expect(s.invalid).toEqual([`${A}|color`]);

    // Con la votación abierta no se pasa a la próxima ronda.
    await expect(act({ type: "closeRound", playerId: A })).rejects.toThrow("votación en curso");

    // Caro vota "vale": ya votaron todos, se cierra con empate y la respuesta queda.
    await vote(C, A, "color", "si");
    s = await view(A);
    expect(s.votes[`${A}|color`]).toMatchObject({ no: 1, yes: 1, pending: 0, done: true });
    expect(s.invalid).toEqual([]);
    await expect(vote(B, A, "color", null)).rejects.toThrow("cerró");

    // Retirar el único "no" hace caer la votación.
    await vote(B, C, "serie", "no");
    await vote(B, C, "serie", null);
    expect((await view(A)).votes[`${C}|serie`]).toBeUndefined();

    // Caro cuestiona el lugar de Beto y Ana no vota: se cierra sola a los 20 s.
    await vote(C, B, "lugar", "no");
    vi.advanceTimersByTime(VOTE_MS - 1000);
    await expect(act({ type: "closeRound", playerId: A })).rejects.toThrow("(1 s)");
    vi.advanceTimersByTime(1000);
    await expect(vote(A, B, "lugar", "si")).rejects.toThrow("cerró");
    await act({ type: "closeRound", playerId: A });

    s = await view(A);
    expect(s.results[0].invalid).toEqual([`${B}|lugar`]);
    expect(s.results[0].votes).toEqual({ [`${A}|color`]: { no: 1, yes: 1 }, [`${B}|lugar`]: { no: 1, yes: 0 } });
    expect(JSON.stringify(s.results)).not.toMatch(/"(bbbbbbbb-2222|cccccccc-3333)":(true|false)/);
    expect(s.votes).toEqual({});
    vi.useRealTimers();
  });
});

describe("categorías elegidas por el dueño", () => {
  it("cleanCategories: sin repetir, en orden, entre 3 y 8", () => {
    expect(cleanCategories(["animal", "nombre", "excusa", "animal"])).toEqual(["nombre", "animal", "excusa"]);
    expect(cleanCategories(["nombre", "animal"])).toBeNull();
    expect(cleanCategories(["nombre", "animal", "pizza"])).toBeNull();
    expect(cleanCategories("nombre")).toBeNull();
    expect(
      cleanCategories(["nombre", "serie", "lugar", "color", "marca", "animal", "fruta", "comida", "objeto"]),
    ).toBeNull();
  });

  it("solo el dueño, antes de la primera ronda; se juega y puntúa con esas", async () => {
    setStore(createMemoryStore());
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    const [A, B] = ["aaaaaaaa-1111", "bbbbbbbb-2222"];
    await act({ type: "join", playerId: A, name: "Ana" });
    await act({ type: "join", playerId: B, name: "Beto" });
    const cats = ["animal", "ropa", "excusa"] as const;
    await expect(act({ type: "setCategories", playerId: B, categories: [...cats] })).rejects.toThrow("dueño");
    await expect(act({ type: "setCategories", playerId: A, categories: ["animal"] })).rejects.toThrow("entre 3 y 8");
    await act({ type: "setCategories", playerId: A, categories: [...cats] });

    await act({ type: "spin", playerId: A });
    vi.advanceTimersByTime(400 + SPIN_MS);
    const st = await getState(A, null);
    if ("same" in st) throw new Error();
    expect(st.game.categories).toEqual(["animal", "ropa", "excusa"]);
    await expect(act({ type: "setCategories", playerId: A, categories: ["nombre", "lugar", "color"] })).rejects.toThrow(
      "antes de la primera ronda",
    );
    const L = st.game.letter!;
    // Las categorías que no se juegan se ignoran.
    await act({ type: "basta", playerId: A, answers: { animal: L + "ana", ropa: L + "opa", excusa: L + "e me hizo tarde", nombre: L + "ola" } });
    await act({ type: "answer", playerId: B, answers: { animal: L + "ana", ropa: L + "emera" } });
    vi.advanceTimersByTime(STOP_MS);
    await act({ type: "closeRound", playerId: A });

    const end = await getState(A, null);
    if ("same" in end) throw new Error();
    expect(end.results[0].categories).toEqual(["animal", "ropa", "excusa"]);
    expect(end.results[0].points[A]).toEqual({ animal: 5, ropa: 10, excusa: 10 });
    expect(end.results[0].answers![A].nombre).toBeUndefined();
    expect(end.totals).toEqual({ [A]: 25, [B]: 15 });
    await expect(act({ type: "setCategories", playerId: A, categories: ["nombre", "lugar", "color"] })).rejects.toThrow();

    // Nueva partida: conserva las categorías elegidas.
    await act({ type: "reset", playerId: A });
    const fresh = await getState(A, null);
    if ("same" in fresh) throw new Error();
    expect(fresh.game.categories).toEqual(["animal", "ropa", "excusa"]);
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
    return { nombre: L + "ola", serie: L + "ole", lugar: L + "oli", color: L + "olo", marca: L + "olu" };
  };

  async function playRound() {
    await act({ type: "spin", playerId: A });
    vi.advanceTimersByTime(400 + SPIN_MS);
    await act({ type: "basta", playerId: A, answers: await full(A) });
    vi.advanceTimersByTime(STOP_MS);
    await act({ type: "closeRound", playerId: A });
  }

  it("partida a 3 rondas termina sola y no deja girar más", async () => {
    await act({ type: "join", playerId: A, name: "Ana" });
    await act({ type: "join", playerId: B, name: "Beto" });
    await expect(act({ type: "setMaxRounds", playerId: A, value: 4 })).rejects.toThrow();
    await expect(act({ type: "setMaxRounds", playerId: B, value: 3 })).rejects.toThrow("dueño");
    await act({ type: "setMaxRounds", playerId: A, value: 3 });
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
    const typed = st.chat.filter((m) => !m.kind);
    expect(typed.map((m) => m.text.length)).toEqual([8, 200]);
    expect(typed[0]).toMatchObject({ text: "hola che", name: "Ana", playerId: A });

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
    expect(st.chat.filter((m) => !m.kind).map((m) => m.text)).toEqual(["¡vamos!"]);
  });
});

describe("answerProblem", () => {
  it("rechaza letras sueltas, repeticiones y cosas sin vocales", () => {
    expect(answerProblem("h", "H", "serie")).toMatch(/corta/);
    expect(answerProblem("Ho", "H", "nombre")).toMatch(/corta/);
    expect(answerProblem("hhhh", "H", "color")).toMatch(/palabra/);
    expect(answerProblem("Hooola", "H", "nombre")).toMatch(/repetidas/);
    expect(answerProblem("Hxzq", "H", "lugar")).toMatch(/vocales/);
    expect(answerProblem("Hrtxzqk", "H", "lugar")).toBeTruthy();
    expect(answerProblem("Gato", "H", "nombre")).toMatch(/No empieza/);
    expect(answerProblem("", "H", "nombre")).toBeNull();
  });

  it("acepta palabras reales, frases y siglas de marcas", () => {
    for (const [a, l, c] of [
      ["Hugo", "H", "nombre"],
      ["Había una vez en Hollywood", "H", "serie"],
      ["Holanda", "H", "lugar"],
      ["Hueso", "H", "color"],
      ["H&M", "H", "marca"],
      ["LG", "L", "marca"],
      ["BMW", "B", "marca"],
      ["Christopher", "C", "nombre"],
      ["Ñandú", "Ñ", "nombre"],
      ["Brooklyn", "B", "lugar"],
      ["Mimo &Co", "M", "marca"],
    ] as const) {
      expect(answerProblem(a, l, c), a).toBeNull();
    }
    expect(answerProblem("hh", "H", "marca")).toBeTruthy();
  });

  it("las inválidas valen 0 en el puntaje", () => {
    const e = { nombre: "", serie: "", lugar: "", color: "", marca: "" };
    const pts = scoreRound("H", { a: { ...e, serie: "h", color: "Hueso" } }, new Set());
    expect(pts.a).toMatchObject({ serie: 0, color: 10 });
  });
});

describe("presencia: avisos de entrada y salida", () => {
  const A = "aaaaaaaa-1111";
  const B = "bbbbbbbb-2222";
  beforeEach(() => {
    setStore(createMemoryStore());
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
  });
  const notices = async () => {
    const st = await getState(A, null);
    if ("same" in st) throw new Error();
    return st.chat.filter((m) => m.kind).map((m) => `${m.name} ${m.kind}`);
  };
  const online = async () => {
    const st = await getState(A, null);
    if ("same" in st) throw new Error();
    return Object.fromEntries(st.players.map((p) => [p.name, p.online]));
  };

  it("avisa al entrar una sola vez, aunque recargue", async () => {
    await act({ type: "join", playerId: A, name: "Ana" });
    await act({ type: "join", playerId: B, name: "Beto" });
    await getState(B, null, true); // latido
    await act({ type: "join", playerId: B, name: "Beto" }); // recarga
    expect(await notices()).toEqual(["Ana join", "Beto join"]);
    expect(await online()).toEqual({ Ana: true, Beto: true });
  });

  it("avisa que se fue cuando deja de dar señales 30 s", async () => {
    await act({ type: "join", playerId: A, name: "Ana" });
    await act({ type: "join", playerId: B, name: "Beto" });
    for (let t = 0; t < 4; t++) {
      vi.advanceTimersByTime(10_000);
      await getState(A, null, true); // Ana sigue, Beto cerró el navegador
    }
    expect(await notices()).toEqual(["Ana join", "Beto join", "Beto leave"]);
    expect(await online()).toEqual({ Ana: true, Beto: false });
    // Vuelve: aviso de entrada de nuevo
    await getState(B, null, true);
    expect((await notices()).at(-1)).toBe("Beto join");
  });

  it("el botón salir avisa al instante, sin duplicar con el latido", async () => {
    await act({ type: "join", playerId: A, name: "Ana" });
    await act({ type: "join", playerId: B, name: "Beto" });
    await act({ type: "leave", playerId: B });
    vi.advanceTimersByTime(40_000);
    await getState(A, null, true);
    expect(await notices()).toEqual(["Ana join", "Beto join", "Beto leave"]);
  });
});

describe("dueño de la sala y turnos de la ruleta", () => {
  const A = "aaaaaaaa-1111";
  const B = "bbbbbbbb-2222";
  const C = "cccccccc-3333";
  beforeEach(() => {
    setStore(createMemoryStore());
    vi.useFakeTimers();
    vi.setSystemTime(7_000_000);
  });
  const roles = async () => {
    const st = await getState(A, null);
    if ("same" in st) throw new Error();
    return { owner: st.ownerId, turn: st.turnId, phase: st.game.phase };
  };
  async function round(spinner: string) {
    await act({ type: "spin", playerId: spinner });
    vi.advanceTimersByTime(400 + SPIN_MS + ROUND_MS + STOP_MS); // se corta solo
    await act({ type: "closeRound", playerId: (await roles()).owner! });
  }

  it("roomRoles: dueño = primero conectado; turno rota salteando desconectados", () => {
    const ps = [
      { id: "a", joinedAt: 1, online: true },
      { id: "b", joinedAt: 2, online: false },
      { id: "c", joinedAt: 3, online: true },
    ];
    expect(roomRoles(ps, null)).toEqual({ ownerId: "a", turnId: "a" });
    expect(roomRoles(ps, "a")).toEqual({ ownerId: "a", turnId: "c" });
    expect(roomRoles(ps, "c")).toEqual({ ownerId: "a", turnId: "a" });
    ps[0].online = false;
    expect(roomRoles(ps, null)).toEqual({ ownerId: "c", turnId: "c" });
  });

  it("el turno pasa entre todos en orden de llegada", async () => {
    vi.setSystemTime(7_000_001);
    await act({ type: "join", playerId: A, name: "Ana" });
    vi.setSystemTime(7_000_002);
    await act({ type: "join", playerId: B, name: "Beto" });
    vi.setSystemTime(7_000_003);
    await act({ type: "join", playerId: C, name: "Caro" });
    expect(await roles()).toMatchObject({ owner: A, turn: A });
    await expect(act({ type: "spin", playerId: B })).rejects.toThrow("Le toca girar a Ana");
    // mantener a todos conectados durante las rondas largas
    const beatAll = async () => {
      for (const id of [A, B, C]) await getState(id, null, true);
    };
    await round(A);
    await beatAll();
    expect((await roles()).turn).toBe(B);
    await round(B);
    await beatAll();
    expect((await roles()).turn).toBe(C);
    await round(A); // el dueño puede girar por Caro
    await beatAll();
    expect((await roles()).turn).toBe(A); // y el turno sigue como si hubiera girado Caro
  });

  it("si el dueño se va manda el siguiente, y al volver lo recupera", async () => {
    await act({ type: "join", playerId: A, name: "Ana" });
    vi.advanceTimersByTime(1);
    await act({ type: "join", playerId: B, name: "Beto" });
    for (let t = 0; t < 4; t++) {
      vi.advanceTimersByTime(10_000);
      await getState(B, null, true); // Ana dejó de dar señales
    }
    expect((await roles()).owner).toBe(B);
    await act({ type: "setMaxRounds", playerId: B, value: 5 });
    await getState(A, null, true); // Ana vuelve
    expect((await roles()).owner).toBe(A);
    await expect(act({ type: "reset", playerId: B })).rejects.toThrow("dueño");
    await act({ type: "reset", playerId: A });
  });
});
