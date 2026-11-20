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
}

const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if (cur == false and ARGV[1] == '') or cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0`;

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
    return ((await this.r.hgetall<Record<string, string>>(key)) ?? {}) as Record<string, string>;
  }
  async del(...keys: string[]) {
    if (keys.length) await this.r.del(...keys);
  }
  keys(pattern: string) {
    return this.r.keys(pattern);
  }
}

class MemoryStore implements Store {
  private kv = new Map<string, string>();
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
