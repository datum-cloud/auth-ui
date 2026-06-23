// app/server/middleware/rate-limit-store.ts
//
// Pluggable shared-store seam for the auth rate limiters.
//
// ⚠️ OPERATIONAL GUARD — replicas: 1.
// The DEFAULT store is in-process (`InMemoryRateLimitStore`): counters are PER-REPLICA, so at
// replicas > 1 the effective limit is (configured limit × replica count) and an attacker's
// requests may scatter across pods. Until the shared store below is PROVISIONED (set
// RATE_LIMIT_REDIS_URL to a reachable redis:// or rediss:// endpoint), auth endpoints MUST run
// `replicas: 1` (or use sticky sessions). The Redis adapter (`RedisRateLimitStore`) lifts that
// constraint by holding counters in a shared sliding-window sorted-set; it is selected ONLY when
// a VALID RATE_LIMIT_REDIS_URL is present. The default (env unset/invalid) path is byte-identical
// to the prior in-memory behavior, so CI / the fitness gate need NO live Redis.
//
// Neutrality invariant: this module holds no loginName/PII — keys are opaque strings minted by
// the middleware (already redacted/hashed there). Nothing here logs or surfaces raw provider
// detail. The Redis adapter only ever stores millisecond timestamps as ZSET scores/members.
import { z } from 'zod';

/** Result of incrementing a key's counter within its current window. */
export interface RateLimitIncrResult {
  /** Number of hits recorded for this key in the active window (this hit inclusive). */
  count: number;
  /** Absolute epoch-ms at which the active window expires (for Retry-After math). */
  resetAt: number;
}

/**
 * Pluggable counter backend. `incr` records one hit for `key` and returns the current count +
 * window reset time. `nowMs` is injectable for deterministic tests (defaults to `Date.now()`).
 *
 * The in-memory adapter is synchronous; the Redis adapter is async — hence the union return.
 */
export interface RateLimitStore {
  incr(
    key: string,
    windowMs: number,
    nowMs?: number
  ): RateLimitIncrResult | Promise<RateLimitIncrResult>;
}

/** Soft cap before the in-memory store sweeps expired buckets to bound memory. */
const IN_MEMORY_SWEEP_THRESHOLD = 10_000;

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * DEFAULT adapter. Fixed-window counter held in an in-process Map — identical semantics to the
 * limiter's original embedded Map (one bucket per key; the window restarts once `windowMs`
 * elapses). State is per-replica (see the replicas: 1 guard at the top of this file).
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();

  /** Exposed for tests/observability — current number of tracked buckets. */
  get size(): number {
    return this.buckets.size;
  }

  incr(key: string, windowMs: number, nowMs: number = Date.now()): RateLimitIncrResult {
    // Sweep expired buckets when the Map exceeds the soft cap to bound memory usage.
    if (this.buckets.size > IN_MEMORY_SWEEP_THRESHOLD) {
      for (const [k, b] of this.buckets) {
        if (nowMs - b.windowStart >= windowMs) this.buckets.delete(k);
      }
    }
    const b = this.buckets.get(key);
    if (!b || nowMs - b.windowStart >= windowMs) {
      this.buckets.set(key, { count: 1, windowStart: nowMs });
      return { count: 1, resetAt: nowMs + windowMs };
    }
    b.count += 1;
    return { count: b.count, resetAt: b.windowStart + windowMs };
  }
}

/**
 * The slice of the `ioredis` `Redis` client this adapter depends on. Declared structurally so the
 * adapter can be unit-tested against an injected fake (never a live server) and so `ioredis`
 * stays a server-only dependency that never reaches the client bundle.
 */
export interface RedisLike {
  zremrangebyscore(key: string, min: number | string, max: number): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number | string>;
  zcard(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
}

/** Monotonic counter so two hits at the same `nowMs` get distinct ZSET members. */
let memberSeq = 0;

/**
 * SHARED adapter. True sliding window backed by one Redis sorted set per key:
 *   1. ZREMRANGEBYSCORE — drop entries older than (now − windowMs) so the window slides.
 *   2. ZADD            — record this hit (score = member = now-ms; a sequence suffix keeps
 *                        members unique when two hits share a millisecond).
 *   3. ZCARD           — the surviving entries are the hit count.
 *   4. PEXPIRE         — let Redis GC idle keys after one window.
 * Selected ONLY when a valid RATE_LIMIT_REDIS_URL is present (see `selectRateLimitStore`).
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisLike) {}

  async incr(
    key: string,
    windowMs: number,
    nowMs: number = Date.now()
  ): Promise<RateLimitIncrResult> {
    const cutoff = nowMs - windowMs;
    await this.redis.zremrangebyscore(key, '-inf', cutoff);
    const member = `${nowMs}-${memberSeq++}`;
    await this.redis.zadd(key, nowMs, member);
    const count = await this.redis.zcard(key);
    // Keep the key alive exactly one window past the latest hit; Redis reclaims it after.
    await this.redis.pexpire(key, windowMs);
    return { count, resetAt: nowMs + windowMs };
  }
}

// RATE_LIMIT_REDIS_URL: optional, validated. Must be a redis:// or rediss:// URL; any other
// value (or unset/empty) fails closed to `undefined` so the limiter stays on the in-memory
// default rather than crashing or silently pointing at a bad endpoint.
const redisUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((u) => u.startsWith('redis://') || u.startsWith('rediss://'), {
    message: 'RATE_LIMIT_REDIS_URL must be a redis:// or rediss:// URL',
  });

/**
 * Validate RATE_LIMIT_REDIS_URL from an env bag. Returns the URL when it is a well-formed
 * redis(s):// endpoint, otherwise `undefined` (the in-memory default path). Never throws —
 * an invalid value is treated as "shared store not configured".
 */
export function resolveRateLimitRedisUrl(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const raw = env.RATE_LIMIT_REDIS_URL;
  if (!raw || raw.trim() === '') return undefined;
  const parsed = redisUrlSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Choose the rate-limit store for the current environment.
 * - No / invalid RATE_LIMIT_REDIS_URL → `InMemoryRateLimitStore` (DEFAULT; no live dependency).
 * - Valid URL → `RedisRateLimitStore` built from `createClient(url)`.
 *
 * `createClient` is injected so this is unit-testable without `ioredis` and without a live
 * server; production callers pass a thin factory that constructs an `ioredis` `Redis`. The
 * factory is invoked ONLY on the valid-URL path, so the default path never imports/connects.
 */
export function selectRateLimitStore(
  env: Record<string, string | undefined> = process.env,
  createClient?: (url: string) => RedisLike
): RateLimitStore {
  const url = resolveRateLimitRedisUrl(env);
  if (!url || !createClient) return new InMemoryRateLimitStore();
  return new RedisRateLimitStore(createClient(url));
}
