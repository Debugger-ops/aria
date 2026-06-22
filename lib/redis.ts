// lib/redis.ts — Redis client singletons with graceful fallback.
//
// Two separate connections are kept because a Redis connection that has run
// SUBSCRIBE can no longer issue normal commands. We therefore keep:
//   • a "command" client  → GET/SET/PUBLISH/cache work
//   • a "subscriber" client → SUBSCRIBE only (created on demand)
//
// If REDIS_URL is not set (or the connection fails), every helper degrades to a
// no-op so the app keeps running without Redis installed.

import Redis, { type RedisOptions } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

export const REDIS_ENABLED = Boolean(REDIS_URL);

// Channel used to fan out "something changed" notifications to SSE clients.
export const UPDATES_CHANNEL = 'aria:updates';

// Cache keys.
export const STATS_CACHE_KEY = 'aria:stats';
export const STATS_CACHE_TTL = 30; // seconds — short, just to absorb bursts

interface RedisCache {
  client: Redis | null;
  warned: boolean;
}

declare global {
  var _ariaRedis: RedisCache | undefined;
}

const cache: RedisCache = global._ariaRedis ?? { client: null, warned: false };
global._ariaRedis = cache;

const baseOptions: RedisOptions = {
  // Fail fast instead of hanging requests if Redis is down.
  maxRetriesPerRequest: 2,
  connectTimeout: 2000,
  enableOfflineQueue: false,
  retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 1000)),
  lazyConnect: false,
};

function makeClient(): Redis | null {
  if (!REDIS_URL) return null;
  const client = new Redis(REDIS_URL, baseOptions);
  client.on('error', (err) => {
    if (!cache.warned) {
      console.warn('[redis] connection error — running without cache/pubsub:', err.message);
      cache.warned = true;
    }
  });
  return client;
}

/** Shared command client (GET/SET/PUBLISH). Returns null if Redis disabled. */
export function getRedis(): Redis | null {
  if (!REDIS_ENABLED) return null;
  if (!cache.client) cache.client = makeClient();
  return cache.client;
}

/** A fresh connection for SUBSCRIBE use. Caller is responsible for quitting it. */
export function createSubscriber(): Redis | null {
  if (!REDIS_ENABLED) return null;
  return makeClient();
}

// ── Cache helpers (all safe no-ops when Redis is unavailable) ─────────

export async function cacheGetJSON<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSetJSON(key: string, value: unknown, ttl = STATS_CACHE_TTL): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, JSON.stringify(value), 'EX', ttl);
  } catch {
    /* ignore cache write failures */
  }
}

export async function cacheDel(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(key);
  } catch {
    /* ignore */
  }
}

/** Publish a JSON payload to the live-updates channel. No-op without Redis. */
export async function publishUpdate(payload: unknown): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.publish(UPDATES_CHANNEL, JSON.stringify(payload));
  } catch {
    /* ignore publish failures */
  }
}
