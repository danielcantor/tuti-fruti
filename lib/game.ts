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
/** Cuenta regresiva después de ¡Basta! para terminar de escribir. */
export const STOP_MS = 5000;
/** Margen para que lleguen las últimas respuestas después de la cuenta regresiva. */
export const GRACE_MS = 3000;
/** Si nadie canta ¡Basta! en este tiempo, la ronda se corta sola. */
export const ROUND_MS = 180_000;
/** Una partida sin límite termina si nadie gira la ruleta en este tiempo. */
export const IDLE_MS = 900_000;
/** Cantidad de rondas a elegir; null = sin límite. */
export const ROUND_OPTIONS: (number | null)[] = [3, 5, 10, null];

export type StoredStatus = "lobby" | "spinning" | "stopping" | "review";
export type Phase = "lobby" | "spinning" | "playing" | "stopping" | "review" | "finished";

export type RoundResult = {
  round: number;
  letter: string;
  /** playerId -> categoría -> puntos */
  points: Record<string, Partial<Record<CategoryKey, number>>>;
  /** Respuestas de la ronda, para el resumen final (no está en partidas viejas). */
  answers?: Record<string, Answers>;
  /** Respuestas anuladas, como "playerId|categoria". */
  invalid?: string[];
  /** Cómo votó cada uno las respuestas cuestionadas (no está en partidas viejas). */
  votes?: Votes;
  /** Quién cantó ¡Basta! (null si se cortó por tiempo). */
  bastaBy?: string | null;
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
  /** null = sin límite (también en partidas guardadas antes de existir el campo). */
  maxRounds?: number | null;
  /** Hora en que se cerró la última ronda. */
  closedAt?: number | null;
  /** Quién tenía el turno en el último giro (para pasarle el turno al siguiente). */
  lastSpinner?: string | null;
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
  maxRounds: null,
  closedAt: null,
  lastSpinner: null,
});

export type RoomPlayer = { id: string; joinedAt: number; online: boolean };

/**
 * Dueño: el que llegó primero entre los conectados (si se va manda el
 * siguiente, y al volver recupera el control). Turno de girar: el próximo
 * conectado, en orden de llegada, después de quien giró la última vez.
 */
export function roomRoles(
  players: RoomPlayer[],
  lastSpinner: string | null | undefined,
): { ownerId: string | null; turnId: string | null } {
  const order = [...players].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  const online = order.filter((p) => p.online);
  const ownerId = online[0]?.id ?? order[0]?.id ?? null;
  if (online.length === 0) return { ownerId, turnId: null };
  const start = order.findIndex((p) => p.id === lastSpinner);
  for (let k = 1; k <= order.length; k++) {
    const p = order[(start + k + order.length) % order.length];
    if (p.online) return { ownerId, turnId: p.id };
  }
  return { ownerId, turnId: online[0].id };
}

export const emptyAnswers = (): Answers => ({
  nombre: "",
  serie: "",
  lugar: "",
  color: "",
  marca: "",
});

type Timing = Pick<Game, "status" | "spinAt" | "bastaAt">;

/** Hora límite de la ronda: después de esto se canta ¡Basta! automático. */
export function roundDeadline(game: Pick<Game, "spinAt">): number | null {
  return game.spinAt === null ? null : game.spinAt + SPIN_MS + ROUND_MS;
}

/** El ¡Basta! cantado, o el automático si se acabó el tiempo de la ronda. */
export function effectiveBastaAt(game: Timing, now: number): number | null {
  if (game.bastaAt !== null) return game.bastaAt;
  const deadline = roundDeadline(game);
  if (game.status === "spinning" && deadline !== null && now >= deadline) return deadline;
  return null;
}

/** Fase efectiva según la hora: el giro, la ronda y la cuenta regresiva terminan solos. */
export function derivePhase(game: Game, now: number): Phase {
  if (game.status === "spinning" || game.status === "stopping") {
    const basta = effectiveBastaAt(game, now);
    if (basta !== null) return now >= basta + STOP_MS ? "review" : "stopping";
    if (game.status === "spinning") {
      return game.spinAt !== null && now >= game.spinAt + SPIN_MS ? "playing" : "spinning";
    }
    return "stopping";
  }
  if (game.status === "lobby" && game.results.length > 0) {
    const max = game.maxRounds ?? null;
    if (max !== null && game.results.length >= max) return "finished";
    if (max === null && game.closedAt != null && now >= game.closedAt + IDLE_MS) return "finished";
  }
  return game.status;
}

/** Ids con el puntaje más alto (varios si hay empate). */
export function winners(t: Record<string, number>): string[] {
  const vals = Object.values(t);
  if (vals.length === 0) return [];
  const top = Math.max(...vals);
  return Object.keys(t).filter((id) => t[id] === top);
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

const VOWELS = /[aeiouy]/;

/**
 * Por qué una respuesta no vale, o null si pasa los controles automáticos.
 * No es un diccionario: atrapa "h", "hhh", "Hxzq" y cosas así. Lo demás se
 * anula a mano en la revisión. Las marcas pueden ser siglas (LG, HP, H&M).
 */
export function answerProblem(answer: string, letter: string, cat: CategoryKey): string | null {
  const n = normalize(answer);
  if (!n) return null; // vacía: no es "inválida", simplemente no suma
  if (!n.startsWith(normalize(letter))) return `No empieza con ${letter}`;
  const ls = n.replace(/[^a-zñ]/g, "");
  const isBrand = cat === "marca";
  const min = isBrand ? 2 : 3;
  if (ls.length < min) return `Muy corta (mínimo ${min} letras)`;
  if (/^(.)\1*$/.test(ls)) return "No es una palabra";
  if (/([a-zñ])\1\1/.test(ls)) return "Tiene letras repetidas de más";
  if (!isBrand) {
    if (!VOWELS.test(ls)) return "No es una palabra (sin vocales)";
    if (n.split(" ").some((w) => /[^aeiouy\s\d]{5,}/.test(w))) return "No es una palabra";
  }
  return null;
}

export const invalidKey = (playerId: string, cat: CategoryKey) => `${playerId}|${cat}`;

/**
 * Votos de la revisión: "playerId|categoria" -> votante -> true si dice que
 * vale, false si dice que no vale. Una respuesta entra en votación cuando
 * alguien vota "no vale".
 */
export type Votes = Record<string, Record<string, boolean>>;

/**
 * Respuestas anuladas por votación: más votos "no vale" que "vale". El empate
 * favorece a quien la escribió, y su propio voto no cuenta. Solo cuentan los
 * votos de quienes siguen en la sala.
 */
export function invalidFromVotes(votes: Votes, voters?: Set<string>): string[] {
  const out: string[] = [];
  for (const [key, byVoter] of Object.entries(votes)) {
    const author = key.split("|")[0];
    let no = 0;
    let yes = 0;
    for (const [voter, ok] of Object.entries(byVoter)) {
      if (voter === author || (voters && !voters.has(voter))) continue;
      if (ok) yes++;
      else no++;
    }
    if (no > yes) out.push(key);
  }
  return out.sort();
}

/** Convierte el hash guardado ("autor|cat|votante" -> "no"/"si") en Votes. */
export function parseVotes(h: Record<string, string>): Votes {
  const out: Votes = {};
  for (const [field, v] of Object.entries(h)) {
    const [author, cat, voter] = field.split("|");
    if (!author || !cat || !voter || (v !== "si" && v !== "no")) continue;
    const key = `${author}|${cat}`;
    (out[key] ??= {})[voter] = v === "si";
  }
  return out;
}

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
      if (normalize(raw) && answerProblem(raw, letter, key) === null && !invalid.has(invalidKey(id, key))) {
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

export type ChatMessage = {
  id: string;
  playerId: string;
  /** Copia del nombre al momento de escribir, por si después sale de la sala. */
  name: string;
  text: string;
  at: number;
  /** Aviso automático (alguien entró o se fue) en lugar de un mensaje escrito. */
  kind?: "join" | "leave";
};

export const CHAT_MAX_LEN = 200;
/** Cada cuánto el navegador avisa que sigue conectado. */
export const HEARTBEAT_MS = 10_000;
/** Sin señales por este tiempo, se considera que la persona se fue. */
export const PRESENCE_TIMEOUT_MS = 30_000;

/** Estado que recibe el navegador. */
export type ClientState = {
  ver: number;
  serverNow: number;
  game: Omit<Game, "results"> & { phase: Phase };
  players: { id: string; name: string; online: boolean }[];
  /** Dueño actual de la sala. */
  ownerId: string | null;
  /** A quién le toca girar la ruleta. */
  turnId: string | null;
  /** En revisión: las de todos. Antes: solo las del que pregunta. */
  answers: Record<string, Answers>;
  invalid: string[];
  /** Votaciones abiertas de la revisión (vacío fuera de la revisión). */
  votes: Votes;
  results: RoundResult[];
  totals: Record<string, number>;
  /** Puntos en vivo de la ronda en revisión. */
  preview: RoundResult["points"] | null;
  /** Últimos mensajes del chat, del más viejo al más nuevo. */
  chat: ChatMessage[];
};
