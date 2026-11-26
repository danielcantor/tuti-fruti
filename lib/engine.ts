import {
  type Answers,
  type CategoryKey,
  type ChatMessage,
  type ClientState,
  type Game,
  type VoteTally,
  type Votes,
  CHAT_MAX_LEN,
  GRACE_MS,
  MAX_CATEGORIES,
  MIN_CATEGORIES,
  PRESENCE_TIMEOUT_MS,
  ROUND_OPTIONS,
  STOP_MS,
  VOTE_MS,
  derivePhase,
  effectiveBastaAt,
  answerProblem,
  cleanCategories,
  gameCategories,
  initialGame,
  markDeadline,
  pickCategories,
  roundCategories,
  invalidFromVotes,
  invalidKey,
  isComplete,
  parseVotes,
  pickLetter,
  roomRoles,
  voteClosed,
  sanitizeAnswers,
  scoreRound,
  totals,
} from "./game";
import { getStore } from "./store";

// Las vistas previas (de Vercel o Netlify) comparten la base de Upstash con
// producción: usan otro prefijo para no mezclar partidas.
const P = process.env.TF_PREVIEW || process.env.VERCEL_ENV === "preview" ? "tfp:" : "tf:";

const K = {
  game: `${P}game`,
  ver: `${P}ver`,
  players: `${P}players`,
  chat: `${P}chat`,
  seen: `${P}seen`,
  present: `${P}present`,
  answers: (round: number) => `${P}answers:${round}`,
  votes: (round: number) => `${P}votes:${round}`,
  /** "playerId|categoria" -> hora en que se abrió la votación. */
  opened: (round: number) => `${P}opened:${round}`,
};

const CHAT_KEEP = 100;
const CHAT_SEND = 50;

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
  const game = raw ? (JSON.parse(raw) as Game) : initialGame();
  game.maxRounds ??= null;
  game.categories = gameCategories(game);
  game.randomCats ??= null;
  game.closedAt ??= null;
  return { raw, game };
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

async function pushNotice(playerId: string, name: string, kind: "join" | "leave") {
  const msg: ChatMessage = {
    id: crypto.randomUUID(),
    playerId,
    name,
    text: kind === "join" ? "entró a la sala" : "se fue",
    at: Date.now(),
    kind,
  };
  await getStore().pushCapped(K.chat, JSON.stringify(msg), CHAT_KEEP);
}

/**
 * Latido de un jugador: lo marca conectado (avisando si recién entra) y, de
 * paso, despide a quienes dejaron de dar señales. HSETNX/HDEL hacen que cada
 * aviso salga una sola vez aunque varios navegadores lleguen a la vez.
 */
export async function heartbeat(playerId: string): Promise<void> {
  const store = getStore();
  const now = Date.now();
  const players = parseHash<{ name: string }>(await store.hgetall(K.players));
  let changed = false;
  if (players[playerId]) {
    await store.hset(K.seen, playerId, String(now));
    if (await store.hsetnx(K.present, playerId, "1")) {
      await pushNotice(playerId, players[playerId].name, "join");
      changed = true;
    }
  }
  const [seen, present] = await Promise.all([store.hgetall(K.seen), store.hgetall(K.present)]);
  for (const id of Object.keys(present)) {
    if (now - Number(seen[id] ?? 0) > PRESENCE_TIMEOUT_MS && (await store.hdel(K.present, id))) {
      await pushNotice(id, players[id]?.name || "Alguien", "leave");
      changed = true;
    }
  }
  if (changed) await store.incr(K.ver);
}

type RoomInfo = { players: { id: string; online: boolean }[] };

/**
 * Votaciones de la ronda: los totales que ve `viewer` (sin decir quién votó
 * qué), las respuestas anuladas por mayoría y las votaciones todavía abiertas.
 */
async function loadVotes(round: number, room: RoomInfo, viewer: string | null, now: number) {
  const store = getStore();
  const [votesH, openedH] = await Promise.all([store.hgetall(K.votes(round)), store.hgetall(K.opened(round))]);
  const ids = new Set(room.players.map((p) => p.id));
  const online = room.players.filter((p) => p.online).map((p) => p.id);
  const all = parseVotes(votesH);
  // Los votos de quien se fue de la sala no cuentan.
  const votes: Votes = {};
  const tallies: Record<string, VoteTally> = {};
  const open: string[] = [];
  for (const [key, at] of Object.entries(openedH)) {
    const author = key.split("|")[0];
    const byVoter = Object.fromEntries(
      Object.entries(all[key] ?? {}).filter(([v]) => ids.has(v) && v !== author),
    );
    votes[key] = byVoter;
    const pending = online.filter((v) => v !== author && !(v in byVoter)).length;
    const mine = viewer && viewer in byVoter ? (byVoter[viewer] ? "si" : "no") : null;
    const t: VoteTally = {
      no: Object.values(byVoter).filter((ok) => !ok).length,
      yes: Object.values(byVoter).filter((ok) => ok).length,
      mine,
      pending,
      endsAt: Number(at) + VOTE_MS,
      done: pending === 0,
    };
    tallies[key] = t;
    if (!voteClosed(t, now)) open.push(key);
  }
  return { tallies, votes, open, invalid: invalidFromVotes(votes, ids) };
}

/** Jugadores con hora de llegada y conexión, y los roles de la sala. */
async function loadRoom(game?: Game) {
  const store = getStore();
  const [playersH, presentH, g] = await Promise.all([
    store.hgetall(K.players),
    store.hgetall(K.present),
    game ? Promise.resolve(game) : readGame().then((r) => r.game),
  ]);
  const info = parseHash<{ name: string; joinedAt: number }>(playersH);
  const players = Object.entries(info).map(([id, p]) => ({
    id,
    name: p.name,
    joinedAt: p.joinedAt ?? 0,
    online: !!presentH[id],
  }));
  return { players, ...roomRoles(players, g.lastSpinner) };
}

export async function getState(
  playerId: string | null,
  knownVer: number | null,
  beat = false,
): Promise<ClientState | { same: true; ver: number; serverNow: number }> {
  const store = getStore();
  if (beat && playerId && validId(playerId)) await heartbeat(playerId);
  const ver = Number((await store.get(K.ver)) ?? 0);
  const now = Date.now();
  if (knownVer !== null && knownVer === ver) return { same: true, ver, serverNow: now };

  const [{ game }, chatRaw] = await Promise.all([readGame(), store.lrange(K.chat, 0, CHAT_SEND - 1)]);
  const room = await loadRoom(game);
  const chat: ChatMessage[] = [];
  for (const raw of chatRaw) {
    try {
      chat.unshift(JSON.parse(raw) as ChatMessage);
    } catch {
      /* ignorar basura */
    }
  }
  const phase = derivePhase(game, now);
  const players = [...room.players]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map(({ id, name, online }) => ({ id, name, online }));

  let answers: Record<string, Answers> = {};
  let invalid: string[] = [];
  let votes: ClientState["votes"] = {};
  let preview: ClientState["preview"] = null;
  if (game.round > 0) {
    const all = parseHash<Answers>(await store.hgetall(K.answers(game.round)));
    if (phase === "review") {
      answers = all;
      ({ tallies: votes, invalid } = await loadVotes(game.round, room, playerId, now));
      preview = scoreRound(game.letter ?? "", all, new Set(invalid), roundCategories(game));
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
    ownerId: room.ownerId,
    turnId: room.turnId,
    answers,
    invalid,
    votes,
    results,
    totals: totals(results),
    preview,
    chat,
  };
}

export type Action =
  | { type: "join"; playerId: string; name: string }
  | { type: "leave"; playerId: string }
  | { type: "spin"; playerId: string }
  | { type: "setMaxRounds"; playerId: string; value: number | null }
  /** `random`: cuántas se sortean por ronda, o null para jugar siempre las mismas. */
  | { type: "setCategories"; playerId: string; categories: CategoryKey[]; random?: number | null }
  | { type: "answer"; playerId: string; answers: Partial<Answers> }
  | { type: "basta"; playerId: string; answers: Partial<Answers> }
  /** "no": no vale (abre la votación si nadie la había cuestionado), "si": vale, null: retirar el voto. */
  | { type: "vote"; playerId: string; target: string; cat: CategoryKey; value: "si" | "no" | null }
  | { type: "closeRound"; playerId: string }
  | { type: "reset"; playerId: string }
  | { type: "chat"; playerId: string; text: string };

export async function act(body: unknown): Promise<void> {
  const a = body as Action;
  if (!a || typeof a !== "object" || !validId(a.playerId)) throw new GameError("Pedido inválido", 400);
  const store = getStore();

  const requireOwner = async (what: string) => {
    const room = await loadRoom();
    if (room.ownerId !== a.playerId) {
      const owner = room.players.find((p) => p.id === room.ownerId)?.name ?? "el dueño";
      throw new GameError(`Solo ${owner}, el dueño de la sala, puede ${what}`, 403);
    }
  };

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
      await heartbeat(a.playerId);
      return;
    }

    case "leave": {
      const p = parseHash<{ name: string }>(await store.hgetall(K.players))[a.playerId];
      await store.hdel(K.players, a.playerId);
      if (p && (await store.hdel(K.present, a.playerId))) await pushNotice(a.playerId, p.name, "leave");
      await store.incr(K.ver);
      return;
    }

    case "spin": {
      await requirePlayer();
      const room = await loadRoom();
      // Gira a quien le toca; el dueño puede girar por esa persona si se colgó.
      if (room.turnId && a.playerId !== room.turnId && a.playerId !== room.ownerId) {
        const who = room.players.find((p) => p.id === room.turnId)?.name ?? "otra persona";
        throw new GameError(`Le toca girar a ${who}`, 403);
      }
      const spinner = room.turnId ?? a.playerId;
      await mutateGame((g, now) => {
        const phase = derivePhase(g, now);
        if (phase === "finished") throw new GameError("La partida terminó. Empezá una nueva.");
        if (phase !== "lobby") throw new GameError("La ronda ya empezó");
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
          lastSpinner: spinner,
          roundCats: g.randomCats ? pickCategories(gameCategories(g), g.randomCats) : null,
        };
      });
      return;
    }

    case "setMaxRounds": {
      await requirePlayer();
      await requireOwner("elegir la cantidad de rondas");
      const value = a.value === null ? null : Number(a.value);
      if (!ROUND_OPTIONS.includes(value)) throw new GameError("Cantidad de rondas inválida", 400);
      await mutateGame((g, now) => {
        if (derivePhase(g, now) !== "lobby" || g.results.length > 0) {
          throw new GameError("La cantidad de rondas se elige antes de la primera ronda");
        }
        return { ...g, maxRounds: value };
      });
      return;
    }

    case "setCategories": {
      await requirePlayer();
      await requireOwner("elegir las categorías");
      const random = a.random == null ? null : Number(a.random);
      const cats = cleanCategories(a.categories, random);
      if (!cats) {
        throw new GameError(
          random === null
            ? `Elegí entre ${MIN_CATEGORIES} y ${MAX_CATEGORIES} categorías`
            : `Para sortear ${random} por ronda, elegí al menos ${random + 1} categorías`,
          400,
        );
      }
      await mutateGame((g, now) => {
        if (derivePhase(g, now) !== "lobby" || g.results.length > 0) {
          throw new GameError("Las categorías se eligen antes de la primera ronda");
        }
        return { ...g, categories: cats, randomCats: random };
      });
      return;
    }

    case "answer":
    case "basta": {
      await requirePlayer();
      const { game } = await readGame();
      const cats = roundCategories(game);
      const answers = sanitizeAnswers(a.answers, cats);
      const now = Date.now();
      const phase = derivePhase(game, now);
      const basta = effectiveBastaAt(game, now);
      const lateOk = phase === "review" && basta !== null && now < basta + STOP_MS + GRACE_MS;
      if (phase !== "playing" && phase !== "stopping" && !lateOk) {
        throw new GameError("La ronda está cerrada");
      }
      await store.hset(K.answers(game.round), a.playerId, JSON.stringify(answers));

      if (a.type === "answer") {
        // Durante el juego las respuestas son privadas; después, todos tienen que verlas.
        if (phase !== "playing") await store.incr(K.ver);
        return;
      }
      if (!game.letter || !isComplete(answers, cats)) {
        throw new GameError(`Completá las ${cats.length} categorías`, 400);
      }
      await mutateGame((g, t) => {
        if (derivePhase(g, t) !== "playing" || g.round !== game.round) return g;
        return { ...g, status: "stopping", bastaBy: a.playerId, bastaAt: t };
      });
      return;
    }

    case "vote": {
      await requirePlayer();
      const { game } = await readGame();
      if (derivePhase(game, Date.now()) !== "review") throw new GameError("Solo se vota en la revisión");
      if (!validId(a.target) || !roundCategories(game).includes(a.cat)) {
        throw new GameError("Pedido inválido", 400);
      }
      if (a.value !== "si" && a.value !== "no" && a.value !== null) throw new GameError("Voto inválido", 400);
      if (a.target === a.playerId) throw new GameError("No podés votar tu propia respuesta", 403);
      const answer = parseHash<Answers>(await store.hgetall(K.answers(game.round)))[a.target]?.[a.cat] ?? "";
      if (!answer.trim()) throw new GameError("Esa respuesta está vacía", 400);
      if (answerProblem(answer, game.letter ?? "", a.cat)) {
        throw new GameError("Esa respuesta ya no vale sola, no hace falta votarla", 400);
      }
      const k = invalidKey(a.target, a.cat);
      const room = await loadRoom(game);
      const now = Date.now();
      const { tallies } = await loadVotes(game.round, room, a.playerId, now);
      const t = tallies[k];
      if (t && voteClosed(t, now)) throw new GameError("Esa votación ya cerró");
      if (!t && a.value !== "no") throw new GameError("Nadie cuestionó esa respuesta", 400);
      if (!t && now >= (markDeadline(game, now) ?? 0)) {
        throw new GameError("Ya pasaron los 20 segundos para marcar palabras");
      }

      const key = K.votes(game.round);
      const field = `${k}|${a.playerId}`;
      if (a.value === null) await store.hdel(key, field);
      else await store.hset(key, field, a.value);
      if (a.value === "no") {
        await store.hsetnx(K.opened(game.round), k, String(now));
      } else {
        // Si ya nadie dice que no vale, la votación se cae (y se puede volver a abrir).
        const left = parseVotes(await store.hgetall(key))[k] ?? {};
        if (!Object.values(left).some((ok) => !ok)) {
          await store.hdel(K.opened(game.round), k);
          for (const v of Object.keys(left)) await store.hdel(key, `${k}|${v}`);
        }
      }
      await store.incr(K.ver);
      return;
    }

    case "closeRound": {
      await requirePlayer();
      await requireOwner("sumar los puntos y cerrar la ronda");
      const { game } = await readGame();
      const room = await loadRoom(game);
      const [answersH, { tallies, open, invalid: roundInvalid }] = await Promise.all([
        store.hgetall(K.answers(game.round)),
        loadVotes(game.round, room, null, Date.now()),
      ]);
      if (open.length > 0) {
        const secs = Math.ceil((Math.max(...open.map((k) => tallies[k].endsAt)) - Date.now()) / 1000);
        throw new GameError(`Hay una votación en curso. Esperá a que termine (${secs} s).`);
      }
      const roundVotes = Object.fromEntries(
        Object.entries(tallies).map(([k, { no, yes }]) => [k, { no, yes }]),
      );
      const roundAnswers = parseHash<Answers>(answersH);
      const cats = roundCategories(game);
      const points = scoreRound(game.letter ?? "", roundAnswers, new Set(roundInvalid), cats);
      await mutateGame((g, now) => {
        if (derivePhase(g, now) !== "review" || g.round !== game.round) return g;
        return {
          ...g,
          status: "lobby",
          letter: null,
          spinAt: null,
          bastaBy: null,
          bastaAt: null,
          closedAt: now,
          results: [
            ...g.results,
            {
              round: g.round,
              letter: g.letter ?? "",
              points,
              answers: roundAnswers,
              invalid: roundInvalid,
              votes: roundVotes,
              bastaBy: g.bastaBy,
              categories: cats,
            },
          ],
        };
      });
      return;
    }

    case "reset": {
      await requirePlayer();
      await requireOwner("empezar una partida nueva");
      const keys = (
        await Promise.all([`${P}answers:*`, `${P}votes:*`, `${P}opened:*`, `${P}invalid:*`].map((k) => store.keys(k)))
      ).flat();
      await store.del(...keys);
      await mutateGame((g) => ({
        ...initialGame(),
        maxRounds: g.maxRounds ?? null,
        categories: gameCategories(g),
        randomCats: g.randomCats ?? null,
      }));
      return;
    }

    case "chat": {
      const text = typeof a.text === "string" ? a.text.replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LEN) : "";
      if (!text) throw new GameError("Escribí un mensaje", 400);
      const players = parseHash<{ name: string }>(await store.hgetall(K.players));
      const me = players[a.playerId];
      if (!me) throw new GameError("Primero entrá con tu nombre", 403);
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        playerId: a.playerId,
        name: me.name,
        text,
        at: Date.now(),
      };
      await store.pushCapped(K.chat, JSON.stringify(msg), CHAT_KEEP);
      await store.incr(K.ver);
      return;
    }

    default:
      throw new GameError("Acción desconocida", 400);
  }
}
