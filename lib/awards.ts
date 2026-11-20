// Premios y curiosidades del final de la partida. Funciones puras, sin I/O.
import { CATEGORIES, type CategoryKey, type RoundResult, normalize } from "./game";

export type Award = {
  key: string;
  emoji: string;
  title: string;
  /** Palabra o dato principal. */
  value: string;
  /** Texto chico debajo; los nombres se agregan aparte con `playerIds`. */
  detail: string;
  playerIds: string[];
};

type Entry = {
  player: string;
  cat: CategoryKey;
  raw: string;
  norm: string;
  points: number;
};

// Frecuencia aproximada de letras en castellano (%). Más baja = más rara.
const FREQ: Record<string, number> = {
  e: 13.7, a: 12.5, o: 8.7, s: 8.0, r: 6.9, n: 6.7, i: 6.3, d: 5.9, l: 5.0, c: 4.7, t: 4.6,
  u: 3.9, m: 3.2, p: 2.5, b: 1.4, g: 1.0, v: 0.9, y: 0.9, q: 0.9, h: 0.7, f: 0.7, z: 0.5,
  j: 0.4, ñ: 0.3, x: 0.2, k: 0.05, w: 0.05,
};

const letters = (norm: string) => norm.replace(/[^a-zñ]/g, "");

/** Promedio de "rareza" de las letras: más alto = letras menos usadas. */
export function rarity(norm: string): number {
  const ls = letters(norm);
  if (!ls) return 0;
  let sum = 0;
  for (const ch of ls) sum += -Math.log((FREQ[ch] ?? 0.05) / 100);
  return sum / ls.length;
}

const catLabel = (k: CategoryKey) => CATEGORIES.find((c) => c.key === k)?.label ?? k;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Ids con el valor más alto (si es > 0). */
function leaders(counts: Map<string, number>): { ids: string[]; n: number } {
  let n = 0;
  for (const v of counts.values()) n = Math.max(n, v);
  if (n <= 0) return { ids: [], n: 0 };
  return { ids: [...counts].filter(([, v]) => v === n).map(([k]) => k), n };
}

function bump(m: Map<string, number>, k: string, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by);
}

export function computeAwards(results: RoundResult[]): Award[] {
  const entries: Entry[] = [];
  for (const r of results) {
    if (!r.answers) continue;
    for (const [player, ans] of Object.entries(r.answers)) {
      for (const { key } of CATEGORIES) {
        const raw = (ans?.[key] ?? "").trim();
        entries.push({ player, cat: key, raw, norm: normalize(raw), points: r.points[player]?.[key] ?? 0 });
      }
    }
  }
  const valid = entries.filter((e) => e.points > 0 && e.norm);
  const awards: Award[] = [];

  // La más repetida (misma palabra, en cualquier ronda o categoría).
  const byWord = new Map<string, Entry[]>();
  for (const e of valid) byWord.set(e.norm, [...(byWord.get(e.norm) ?? []), e]);
  let common: Entry[] = [];
  for (const list of byWord.values()) if (list.length > common.length) common = list;
  if (common.length >= 2) {
    awards.push({
      key: "common",
      emoji: "🤝",
      title: "La más repetida",
      value: common[0].raw,
      detail: `${plural(common.length, "vez", "veces")} · la pusieron`,
      playerIds: [...new Set(common.map((e) => e.player))],
    });
  }

  // La más rara: dicha una sola vez y con las letras menos usadas.
  const unique = valid.filter((e) => byWord.get(e.norm)!.length === 1);
  if (unique.length > 0) {
    const rare = unique.reduce((best, e) => {
      const d = rarity(e.norm) - rarity(best.norm);
      return d > 1e-9 || (Math.abs(d) <= 1e-9 && letters(e.norm).length > letters(best.norm).length) ? e : best;
    });
    awards.push({
      key: "rare",
      emoji: "🦄",
      title: "La más rara",
      value: rare.raw,
      detail: `${catLabel(rare.cat)} · nadie más la dijo · de`,
      playerIds: [rare.player],
    });
  }

  // La más larga y la más corta.
  if (valid.length > 0) {
    const len = (e: Entry) => letters(e.norm).length;
    const longest = valid.reduce((a, b) => (len(b) > len(a) ? b : a));
    awards.push({
      key: "long",
      emoji: "📏",
      title: "La más larga",
      value: longest.raw,
      detail: `${plural(len(longest), "letra", "letras")} · ${catLabel(longest.cat)} · de`,
      playerIds: [longest.player],
    });
    const shortest = valid.reduce((a, b) => (len(b) < len(a) ? b : a));
    if (len(shortest) < len(longest)) {
      awards.push({
        key: "short",
        emoji: "🐜",
        title: "La más corta",
        value: shortest.raw,
        detail: `${plural(len(shortest), "letra", "letras")} · ${catLabel(shortest.cat)} · de`,
        playerIds: [shortest.player],
      });
    }
  }

  // Más respuestas únicas (las de 10 puntos).
  const originals = new Map<string, number>();
  for (const e of valid) if (e.points === 10) bump(originals, e.player);
  const orig = leaders(originals);
  if (orig.n > 0) {
    awards.push({
      key: "original",
      emoji: "✨",
      title: "Más original",
      value: plural(orig.n, "respuesta única", "respuestas únicas"),
      detail: "",
      playerIds: orig.ids,
    });
  }

  // Quién cantó más ¡Basta!
  const bastas = new Map<string, number>();
  for (const r of results) if (r.bastaBy) bump(bastas, r.bastaBy);
  const fast = leaders(bastas);
  if (fast.n > 0) {
    awards.push({
      key: "fast",
      emoji: "⚡",
      title: "Más rápido",
      value: `Cantó ¡Basta! ${plural(fast.n, "vez", "veces")}`,
      detail: "",
      playerIds: fast.ids,
    });
  }

  // Más respuestas anuladas.
  const annulled = new Map<string, number>();
  for (const r of results) for (const k of r.invalid ?? []) bump(annulled, k.split("|")[0]);
  const cheat = leaders(annulled);
  if (cheat.n > 0) {
    awards.push({
      key: "annulled",
      emoji: "🚩",
      title: "Más anuladas",
      value: plural(cheat.n, "respuesta anulada", "respuestas anuladas"),
      detail: "",
      playerIds: cheat.ids,
    });
  }

  // Más casilleros vacíos (solo cuenta lo que cada uno mandó en cada ronda).
  const empties = new Map<string, number>();
  for (const e of entries) if (!e.raw) bump(empties, e.player);
  const lazy = leaders(empties);
  if (lazy.n > 0) {
    awards.push({
      key: "empty",
      emoji: "🕳️",
      title: "Más casilleros vacíos",
      value: plural(lazy.n, "casillero vacío", "casilleros vacíos"),
      detail: "",
      playerIds: lazy.ids,
    });
  }

  // Categoría más difícil: la que más quedó en cero.
  const zeros = new Map<string, number>();
  const totalsByCat = new Map<string, number>();
  for (const e of entries) {
    bump(totalsByCat, e.cat);
    if (e.points === 0) bump(zeros, e.cat);
  }
  const hard = leaders(zeros);
  if (hard.n > 0) {
    const cat = hard.ids[0] as CategoryKey;
    awards.push({
      key: "hard",
      emoji: "🧩",
      title: "Categoría más difícil",
      value: catLabel(cat),
      detail: `${hard.n} de ${totalsByCat.get(cat)} respuestas sin puntos`,
      playerIds: [],
    });
  }

  return awards;
}
