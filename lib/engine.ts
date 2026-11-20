import {
  type Answers,
  type CategoryKey,
  type ClientState,
  type Game,
  CATEGORIES,
  GRACE_MS,
  STOP_MS,
  derivePhase,
  initialGame,
  invalidKey,
  isComplete,
  pickLetter,
  sanitizeAnswers,
  scoreRound,
  totals,
} from "./game";
import { getStore } from "./store";

const K = {
  game: "tf:game",
  ver: "tf:ver",
  players: "tf:players",
  answers: (round: number) => `tf:answers:${round}`,
  invalid: (round: number) => `tf:invalid:${round}`,
};

export class GameError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

async function readGame(): Promise<{ raw: string | null; game: Game }> {
  const raw = await getStore().get(K.game);
  return { raw, game: raw ? (JSON.parse(raw) as Game) : initialGame() };
}

/** Cambia el juego de forma atómica; reintenta si otro jugador escribió al mismo tiempo. */
async function mutateGame(fn: (game: Game, now: number) => Game): Promise<Game> {
  const store = getStore();
  for (let i = 0; i < 6; i++) {
    const { raw, game } = await readGame();
    const next = fn(structuredClone(game), Date.now());
    if (await store.cas(K.game, raw, JSON.stringify(next))) {
      await store.incr(K.ver);
      return next;
    }
  }
  throw new GameError("Hay mucha gente apretando a la vez, probá de nuevo.");
}

const cleanName = (s: unknown) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 24) : "";
const validId = (s: unknown): s is string => typeof s === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(s);

function parseHash<T>(h: Record<string, string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(h)) {
    try {
      out[k] = JSON.parse(v) as T;
    } catch {
      /* ignorar basura */
    }
  }
  return out;
}

export async function getState(
  playerId: string | null,
  knownVer: number | null,
): Promise<ClientState | { same: true; ver: number; serverNow: number }> {
  const store = getStore();
  const ver = Number((await store.get(K.ver)) ?? 0);
  const now = Date.now();
  if (knownVer !== null && knownVer === ver) return { same: true, ver, serverNow: now };

  const [{ game }, playersH] = await Promise.all([readGame(), store.hgetall(K.players)]);
  const phase = derivePhase(game, now);
  const players = Object.entries(parseHash<{ name: string; joinedAt: number }>(playersH))
    .sort((a, b) => a[1].joinedAt - b[1].joinedAt)
    .map(([id, p]) => ({ id, name: p.name }));

  let answers: Record<string, Answers> = {};
  let invalid: string[] = [];
  let preview: ClientState["preview"] = null;
  if (game.round > 0) {
    const all = parseHash<Answers>(await store.hgetall(K.answers(game.round)));
    if (phase === "review") {
      answers = all;
      invalid = Object.keys(await store.hgetall(K.invalid(game.round)));
      preview = scoreRound(game.letter ?? "", all, new Set(invalid));
    } else if (playerId && all[playerId] && phase !== "lobby") {
      answers = { [playerId]: all[playerId] };
    }
  }

  const { results, ...rest } = game;
  return {
    ver,
    serverNow: now,
    game: { ...rest, phase },
    players,
    answers,
    invalid,
    results,
    totals: totals(results),
    preview,
  };
}

export type Action =
  | { type: "join"; playerId: string; name: string }
  | { type: "leave"; playerId: string }
  | { type: "spin"; playerId: string }
  | { type: "answer"; playerId: string; answers: Partial<Answers> }
  | { type: "basta"; playerId: string; answers: Partial<Answers> }
  | { type: "toggleInvalid"; playerId: string; target: string; cat: CategoryKey }
  | { type: "closeRound"; playerId: string }
  | { type: "reset"; playerId: string };

export async function act(body: unknown): Promise<void> {
  const a = body as Action;
  if (!a || typeof a !== "object" || !validId(a.playerId)) throw new GameError("Pedido inválido", 400);
  const store = getStore();

  const requirePlayer = async () => {
    const p = await store.hgetall(K.players);
    if (!p[a.playerId]) throw new GameError("Primero entrá con tu nombre", 403);
  };

  switch (a.type) {
    case "join": {
      const name = cleanName(a.name);
      if (!name) throw new GameError("Escribí tu nombre", 400);
      const existing = parseHash<{ joinedAt: number }>(await store.hgetall(K.players))[a.playerId];
      await store.hset(
        K.players,
        a.playerId,
        JSON.stringify({ name, joinedAt: existing?.joinedAt ?? Date.now() }),
      );
      await store.incr(K.ver);
      return;
    }

    case "leave": {
      await store.hdel(K.players, a.playerId);
      await store.incr(K.ver);
      return;
    }

    case "spin": {
      await requirePlayer();
      await mutateGame((g, now) => {
        if (derivePhase(g, now) !== "lobby") throw new GameError("La ronda ya empezó");
        const { letter, used } = pickLetter(g.usedLetters);
        return {
          ...g,
          round: g.round + 1,
          status: "spinning",
          letter,
          usedLetters: used,
          spinAt: now + 400,
          bastaBy: null,
          bastaAt: null,
        };
      });
      return;
    }

    case "answer":
    case "basta": {
      await requirePlayer();
      const answers = sanitizeAnswers(a.answers);
      const { game } = await readGame();
      const now = Date.now();
      const phase = derivePhase(game, now);
      const lateOk =
        phase === "review" && game.bastaAt !== null && now < game.bastaAt + STOP_MS + GRACE_MS;
      if (phase !== "playing" && phase !== "stopping" && !lateOk) {
        throw new GameError("La ronda está cerrada");
      }
      await store.hset(K.answers(game.round), a.playerId, JSON.stringify(answers));

      if (a.type === "answer") {
        // Durante el juego las respuestas son privadas; después, todos tienen que verlas.
        if (phase !== "playing") await store.incr(K.ver);
        return;
      }
      if (!game.letter || !isComplete(answers)) throw new GameError("Completá las 5 categorías", 400);
      await mutateGame((g, t) => {
        if (derivePhase(g, t) !== "playing" || g.round !== game.round) return g;
        return { ...g, status: "stopping", bastaBy: a.playerId, bastaAt: t };
      });
      return;
    }

    case "toggleInvalid": {
      await requirePlayer();
      const { game } = await readGame();
      if (derivePhase(game, Date.now()) !== "review") throw new GameError("Solo en la revisión");
      if (!validId(a.target) || !CATEGORIES.some((c) => c.key === a.cat)) {
        throw new GameError("Pedido inválido", 400);
      }
      const key = K.invalid(game.round);
      const field = invalidKey(a.target, a.cat);
      const cur = await store.hgetall(key);
      if (cur[field]) await store.hdel(key, field);
      else await store.hset(key, field, a.playerId);
      await store.incr(K.ver);
      return;
    }

    case "closeRound": {
      await requirePlayer();
      const { game } = await readGame();
      const [answersH, invalidH] = await Promise.all([
        store.hgetall(K.answers(game.round)),
        store.hgetall(K.invalid(game.round)),
      ]);
      const points = scoreRound(
        game.letter ?? "",
        parseHash<Answers>(answersH),
        new Set(Object.keys(invalidH)),
      );
      await mutateGame((g, now) => {
        if (derivePhase(g, now) !== "review" || g.round !== game.round) return g;
        return {
          ...g,
          status: "lobby",
          letter: null,
          spinAt: null,
          bastaBy: null,
          bastaAt: null,
          results: [...g.results, { round: g.round, letter: g.letter ?? "", points }],
        };
      });
      return;
    }

    case "reset": {
      await requirePlayer();
      const keys = (await store.keys("tf:answers:*")).concat(await store.keys("tf:invalid:*"));
      await store.del(...keys);
      await mutateGame(() => initialGame());
      return;
    }

    default:
      throw new GameError("Acción desconocida", 400);
  }
}
