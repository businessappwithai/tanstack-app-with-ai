/**
 * Every in-process cache in the application, each with an expiry set in `.env`.
 *
 *   CACHE_TTL_<NAME>_MS    how long an entry of cache <NAME> is served, in ms
 *   CACHE_TTL_DEFAULT_MS   for any cache without its own setting (6000)
 *
 * `0` turns that cache off — every read goes to the database — which is how to
 * measure what a cache is worth before tuning it. The value is read once, when
 * the cache is created, and logged (`cache.configured`), so a running server
 * says what it uses.
 *
 * Expiry is the backstop, not the only way an entry leaves. Whatever owns a
 * cache still drops entries the moment it knows they changed (a dictionary
 * edit, an access change announced by the database); the expiry bounds how long
 * any instance can be wrong when such a signal is lost.
 *
 * Plain TypeScript, no model data — copied into every generated backend as is.
 */

import { getLogger } from './logging/logger.service';

/** The expiry used by a cache with no setting of its own, and by the default when unset. */
export const DEFAULT_CACHE_TTL_MS = 6000;

/** `entityMetadata` → `CACHE_TTL_ENTITY_METADATA_MS`. */
export function ttlVariable(name: string): string {
  const snake = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_');
  return `CACHE_TTL_${snake.toUpperCase()}_MS`;
}

function readMs(
  variable: string,
  env: Record<string, string | undefined>,
  cache: string,
  fallback: number,
): number | undefined {
  const raw = env[variable];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0) return Math.floor(value);
  getLogger('cache').event('cache.config.invalid', { cache, variable, defaultMs: fallback });
  return undefined;
}

/** The expiry a cache named `name` runs with, and where it came from. */
export function cacheTtl(
  name: string,
  env: Record<string, string | undefined> = process.env,
): { ttlMs: number; source: string } {
  const own = ttlVariable(name);
  const fallback =
    readMs('CACHE_TTL_DEFAULT_MS', env, name, DEFAULT_CACHE_TTL_MS) ?? DEFAULT_CACHE_TTL_MS;
  const ttlMs = readMs(own, env, name, fallback);
  if (ttlMs !== undefined) return { ttlMs, source: own };
  return {
    ttlMs: fallback,
    source: env.CACHE_TTL_DEFAULT_MS ? 'CACHE_TTL_DEFAULT_MS' : 'default',
  };
}

export interface TtlCache<K, V> {
  readonly name: string;
  readonly ttlMs: number;
  get(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): void;
  delete(key: K): void;
  clear(): void;
  /** The keys of entries not yet expired. */
  keys(): K[];
  readonly size: number;
}

export interface CacheOptions {
  /** At most this many entries; the oldest is dropped first. Default 10 000. */
  maxEntries?: number;
  /** Override `.env` — for tests. */
  ttlMs?: number;
  /** The clock — for tests. */
  now?: () => number;
}

/**
 * A map whose entries expire. Insertion order is kept, and re-setting a key moves
 * it to the end, so dropping the first entry when full drops the least recently
 * written one.
 */
export function createCache<K, V>(name: string, options: CacheOptions = {}): TtlCache<K, V> {
  const configured = options.ttlMs === undefined ? cacheTtl(name) : { ttlMs: options.ttlMs, source: 'code' };
  const ttlMs = configured.ttlMs;
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 10_000;
  const entries = new Map<K, { value: V; expires: number }>();

  getLogger('cache').event('cache.configured', { cache: name, ttlMs, source: configured.source });

  const live = (key: K) => {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    name,
    ttlMs,
    get: (key) => live(key)?.value,
    has: (key) => live(key) !== undefined,
    set(key, value) {
      if (ttlMs <= 0) return;
      entries.delete(key);
      entries.set(key, { value, expires: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    delete: (key) => {
      entries.delete(key);
    },
    clear: () => entries.clear(),
    keys: () => [...entries.keys()].filter((key) => live(key) !== undefined),
    get size() {
      return entries.size;
    },
  };
}
