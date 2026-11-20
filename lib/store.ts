import { Redis } from "@upstash/redis";

/** Lo mínimo que necesita el juego. Redis en producción, memoria en desarrollo. */
export interface Store {
  get(key: string): Promise<string | null>;
  /** Escribe `next` solo si el valor actual es `expected` (null = no existe). */
  cas(key: string, expected: string | null, next: string): Promise<boolean>;
  incr(key: string): Promise<number>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  del(...keys: string[]): Promise<void>;
  keys(pattern: string): Promise<string[]>;
  /** Agrega al principio de la lista y la recorta a `max` elementos. */
  pushCapped(key: string, value: string, max: number): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if (cur == false and ARGV[1] == '') or cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0`;

/** Convierte la respuesta de HGETALL (lista plana u objeto) en un objeto campo → valor. */
export function hashFromReply(reply: unknown): Record<string, string> {
  if (!reply) return {};
  if (Array.isArray(reply)) {
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < reply.length; i += 2) out[String(reply[i])] = String(reply[i + 1]);
    return out;
  }
  if (typeof reply === "object") {
    return Object.fromEntries(
      Object.entries(reply as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
    );
  }
  return {};
}

class RedisStore implements Store {
  constructor(private r: Redis) {}
  async get(key: string) {
    return (await this.r.get<string>(key)) ?? null;
  }
  async cas(key: string, expected: string | null, next: string) {
    const res = await this.r.eval(CAS_SCRIPT, [key], [expected ?? "", next]);
    return Number(res) === 1;
  }
  incr(key: string) {
    return this.r.incr(key);
  }
  async hset(key: string, field: string, value: string) {
    await this.r.hset(key, { [field]: value });
  }
  async hdel(key: string, field: string) {
    await this.r.hdel(key, field);
  }
  async hgetall(key: string) {
    // Con automaticDeserialization: false, HGETALL llega como lista plana [campo, valor, ...].
    return hashFromReply(await this.r.hgetall(key));
  }
  async del(...keys: string[]) {
    if (keys.length) await this.r.del(...keys);
  }
  keys(pattern: string) {
    return this.r.keys(pattern);
  }
  async pushCapped(key: string, value: string, max: number) {
    const p = this.r.pipeline();
    p.lpush(key, value);
    p.ltrim(key, 0, max - 1);
    await p.exec();
  }
  async lrange(key: string, start: number, stop: number) {
    return ((await this.r.lrange(key, start, stop)) ?? []).map(String);
  }
}

class MemoryStore implements Store {
  private kv = new Map<string, string>();
  private lists = new Map<string, string[]>();
  async pushCapped(key: string, value: string, max: number) {
    const l = [value, ...(this.lists.get(key) ?? [])].slice(0, max);
    this.lists.set(key, l);
  }
  async lrange(key: string, start: number, stop: number) {
    const l = this.lists.get(key) ?? [];
    return l.slice(start, stop < 0 ? l.length + stop + 1 : stop + 1);
  }
  private h = new Map<string, Map<string, string>>();
  async get(key: string) {
    return this.kv.get(key) ?? null;
  }
  async cas(key: string, expected: string | null, next: string) {
    if ((this.kv.get(key) ?? null) !== expected) return false;
    this.kv.set(key, next);
    return true;
  }
  async incr(key: string) {
    const n = Number(this.kv.get(key) ?? 0) + 1;
    this.kv.set(key, String(n));
    return n;
  }
  async hset(key: string, field: string, value: string) {
    if (!this.h.has(key)) this.h.set(key, new Map());
    this.h.get(key)!.set(field, value);
  }
  async hdel(key: string, field: string) {
    this.h.get(key)?.delete(field);
  }
  async hgetall(key: string) {
    return Object.fromEntries(this.h.get(key) ?? []);
  }
  async del(...keys: string[]) {
    for (const k of keys) {
      this.kv.delete(k);
      this.h.delete(k);
    }
  }
  async keys(pattern: string) {
    const prefix = pattern.replace(/\*$/, "");
    return [...this.kv.keys(), ...this.h.keys()].filter((k) => k.startsWith(prefix));
  }
}

const g = globalThis as unknown as { __tfStore?: Store };

export function getStore(): Store {
  if (g.__tfStore) return g.__tfStore;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    g.__tfStore = new RedisStore(new Redis({ url, token, automaticDeserialization: false }));
  } else {
    if (process.env.VERCEL) {
      throw new Error("Falta conectar Upstash Redis (UPSTASH_REDIS_REST_URL / KV_REST_API_URL).");
    }
    g.__tfStore = new MemoryStore();
  }
  return g.__tfStore;
}

/** Solo para tests. */
export function setStore(s: Store) {
  g.__tfStore = s;
}
export const createMemoryStore = (): Store => new MemoryStore();
