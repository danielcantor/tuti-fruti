// Lógica pura del juego: tipos, constantes, fases y puntaje. Sin I/O.

export const LETTERS = "ABCDEFGHIJLMNOPRSTUVZ".split("");

export const CATEGORIES = [
  { key: "nombre", label: "Nombre" },
  { key: "serie", label: "Serie / Película" },
  { key: "lugar", label: "Lugar" },
  { key: "color", label: "Color" },
  { key: "marca", label: "Marca" },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export type Answers = Record<CategoryKey, string>;

export const SPIN_MS = 4500;
export const STOP_MS = 10000;
/** Margen para que lleguen las últimas respuestas después de la cuenta regresiva. */
export const GRACE_MS = 3000;

export type StoredStatus = "lobby" | "spinning" | "stopping" | "review";
export type Phase = "lobby" | "spinning" | "playing" | "stopping" | "review";

export type RoundResult = {
  round: number;
  letter: string;
  /** playerId -> categoría -> puntos */
  points: Record<string, Partial<Record<CategoryKey, number>>>;
};

export type Game = {
  round: number;
  status: StoredStatus;
  letter: string | null;
  spinAt: number | null;
  bastaBy: string | null;
  bastaAt: number | null;
  usedLetters: string[];
  results: RoundResult[];
};

export const initialGame = (): Game => ({
  round: 0,
  status: "lobby",
  letter: null,
  spinAt: null,
  bastaBy: null,
  bastaAt: null,
  usedLetters: [],
  results: [],
});

export const emptyAnswers = (): Answers => ({
  nombre: "",
  serie: "",
  lugar: "",
  color: "",
  marca: "",
});

/** Fase efectiva según la hora: el giro y la cuenta regresiva terminan solos. */
export function derivePhase(game: Game, now: number): Phase {
  if (game.status === "spinning") {
    return game.spinAt !== null && now >= game.spinAt + SPIN_MS ? "playing" : "spinning";
  }
  if (game.status === "stopping") {
    return game.bastaAt !== null && now >= game.bastaAt + STOP_MS ? "review" : "stopping";
  }
  return game.status;
}

export function pickLetter(used: string[], rand: () => number = Math.random): { letter: string; used: string[] } {
  let pool = LETTERS.filter((l) => !used.includes(l));
  let base = used;
  if (pool.length === 0) {
    pool = LETTERS;
    base = [];
  }
  const letter = pool[Math.floor(rand() * pool.length)];
  return { letter, used: [...base, letter] };
}

/** Minúsculas, sin acentos (la ñ se mantiene), sin espacios ni puntuación extra. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ñ/g, "\u0000")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0000/g, "ñ")
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function startsWithLetter(answer: string, letter: string): boolean {
  const n = normalize(answer);
  return n.length > 0 && n.startsWith(normalize(letter));
}

export const invalidKey = (playerId: string, cat: CategoryKey) => `${playerId}|${cat}`;

/**
 * 10 si la respuesta válida es única, 5 si otro jugador puso lo mismo,
 * 0 si está vacía, no empieza con la letra o fue marcada como inválida.
 */
export function scoreRound(
  letter: string,
  answers: Record<string, Partial<Answers>>,
  invalid: Set<string>,
): RoundResult["points"] {
  const points: RoundResult["points"] = {};
  const ids = Object.keys(answers);
  for (const id of ids) points[id] = {};

  for (const { key } of CATEGORIES) {
    const valid = new Map<string, string>();
    for (const id of ids) {
      const raw = answers[id]?.[key] ?? "";
      if (startsWithLetter(raw, letter) && !invalid.has(invalidKey(id, key))) {
        valid.set(id, normalize(raw));
      }
    }
    const counts = new Map<string, number>();
    for (const v of valid.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const id of ids) {
      const v = valid.get(id);
      points[id][key] = v === undefined ? 0 : (counts.get(v) ?? 0) > 1 ? 5 : 10;
    }
  }
  return points;
}

export function totals(results: RoundResult[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const r of results) {
    for (const [id, cats] of Object.entries(r.points)) {
      t[id] = (t[id] ?? 0) + Object.values(cats).reduce((a, b) => a + (b ?? 0), 0);
    }
  }
  return t;
}

export function isComplete(a: Partial<Answers>): boolean {
  return CATEGORIES.every(({ key }) => (a[key] ?? "").trim().length > 0);
}

export function sanitizeAnswers(input: unknown): Answers {
  const out = emptyAnswers();
  if (input && typeof input === "object") {
    for (const { key } of CATEGORIES) {
      const v = (input as Record<string, unknown>)[key];
      if (typeof v === "string") out[key] = v.slice(0, 60);
    }
  }
  return out;
}

/** Estado que recibe el navegador. */
export type ClientState = {
  ver: number;
  serverNow: number;
  game: Omit<Game, "results"> & { phase: Phase };
  players: { id: string; name: string }[];
  /** En revisión: las de todos. Antes: solo las del que pregunta. */
  answers: Record<string, Answers>;
  invalid: string[];
  results: RoundResult[];
  totals: Record<string, number>;
  /** Puntos en vivo de la ronda en revisión. */
  preview: RoundResult["points"] | null;
};
