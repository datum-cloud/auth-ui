// app/server/middleware/__tests__/rate-limit-store.test.ts
//
// Pluggable shared-store rate limiter.
// - The in-memory adapter (DEFAULT) counts + expires correctly under an injected clock.
// - The ioredis sliding-window adapter is exercised against an INJECTED FAKE client
//   (never a live server) so CI/the gate need no Redis.
// - The store selector resolves to in-memory when RATE_LIMIT_REDIS_URL is absent and to
//   the Redis adapter only when the validated env var is present.
import { RateLimiter } from '../rate-limit';
import {
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  resolveRateLimitRedisUrl,
  selectRateLimitStore,
  type RedisLike,
} from '../rate-limit-store';
import { describe, it, expect, vi } from 'vitest';

describe('InMemoryRateLimitStore (default adapter)', () => {
  it('counts increments within a window', () => {
    const store = new InMemoryRateLimitStore();
    expect(store.incr('k', 1000, 0).count).toBe(1);
    expect(store.incr('k', 1000, 100).count).toBe(2);
    expect(store.incr('k', 1000, 200).count).toBe(3);
  });

  it('resetAt is windowStart + windowMs and is stable across a window', () => {
    const store = new InMemoryRateLimitStore();
    const first = store.incr('k', 1000, 50);
    expect(first.resetAt).toBe(1050); // 50 (windowStart) + 1000
    const second = store.incr('k', 1000, 400);
    expect(second.resetAt).toBe(1050); // unchanged within the same window
  });

  it('expires + restarts the window once windowMs elapses', () => {
    const store = new InMemoryRateLimitStore();
    expect(store.incr('k', 1000, 0).count).toBe(1);
    expect(store.incr('k', 1000, 500).count).toBe(2);
    // At/after windowMs the window restarts: count drops back to 1.
    const fresh = store.incr('k', 1000, 1000);
    expect(fresh.count).toBe(1);
    expect(fresh.resetAt).toBe(2000); // 1000 + 1000
  });

  it('isolates distinct keys', () => {
    const store = new InMemoryRateLimitStore();
    expect(store.incr('a', 1000, 0).count).toBe(1);
    expect(store.incr('b', 1000, 0).count).toBe(1);
  });

  it('sweeps expired buckets when the map exceeds the soft cap (bounded memory)', () => {
    const store = new InMemoryRateLimitStore();
    // Seed >10k distinct keys, all in window [0, 1000).
    for (let i = 0; i <= 10_001; i++) store.incr(`k${i}`, 1000, 0);
    expect(store.size).toBeGreaterThan(10_000);
    // A new incr far past the window triggers the sweep of expired buckets.
    store.incr('trigger', 1000, 10_000);
    // The old buckets are gone; only the fresh one (and the trigger) remain small.
    expect(store.size).toBeLessThan(10);
  });
});

describe('RateLimiter delegates to the in-memory store (default behavior unchanged)', () => {
  it('allows up to the limit, then blocks within the window', () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
    const k = 'ip|alice';
    expect(rl.check(k, 0).allowed).toBe(true);
    expect(rl.check(k, 10).allowed).toBe(true);
    expect(rl.check(k, 20).allowed).toBe(true);
    const fourth = rl.check(k, 30);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it('accepts an injected store (pluggable seam)', () => {
    // A trivial fake store that always reports the same count — proves the seam exists
    // and RateLimiter routes through the store's synchronous incr rather than an internal Map.
    // RateLimiter's constructor is narrowed to the synchronous InMemoryRateLimitStore adapter
    // (an async store cannot be injected into the sync check path), so the fake is typed as
    // that adapter; only the synchronous `incr` surface is exercised here.
    const calls: Array<{ key: string; windowMs: number }> = [];
    const fake = {
      incr(key: string, windowMs: number, nowMs?: number) {
        calls.push({ key, windowMs });
        return { count: 1, resetAt: (nowMs ?? 0) + windowMs };
      },
    } as unknown as InMemoryRateLimitStore;
    const rl = new RateLimiter({ limit: 5, windowMs: 1000 }, fake);
    expect(rl.check('k', 0).allowed).toBe(true);
    expect(calls).toEqual([{ key: 'k', windowMs: 1000 }]);
  });
});

// ---------------------------------------------------------------------------
// RedisRateLimitStore — unit-tested against an INJECTED FAKE ioredis client.
// The sliding window uses a sorted set per key (ZADD member=nowMs score=nowMs),
// trims entries older than (now - windowMs) with ZREMRANGEBYSCORE, then ZCARD counts
// the survivors. We assert the call sequence + the derived count/resetAt — never a
// live server.
// ---------------------------------------------------------------------------
function makeFakeRedis(): RedisLike & {
  zsets: Map<string, number[]>;
  ops: string[];
} {
  const zsets = new Map<string, number[]>();
  const ops: string[] = [];
  return {
    zsets,
    ops,
    async zremrangebyscore(key: string, _min: number | string, max: number) {
      ops.push('zremrangebyscore');
      const arr = zsets.get(key) ?? [];
      zsets.set(
        key,
        arr.filter((score) => score > Number(max))
      );
      return 0;
    },
    async zadd(key: string, score: number, _member: string) {
      ops.push('zadd');
      const arr = zsets.get(key) ?? [];
      arr.push(score);
      zsets.set(key, arr);
      return 1;
    },
    async zcard(key: string) {
      ops.push('zcard');
      return (zsets.get(key) ?? []).length;
    },
    async pexpire(_key: string, _ms: number) {
      ops.push('pexpire');
      return 1;
    },
  };
}

describe('RedisRateLimitStore (ioredis sliding-window adapter, fake client)', () => {
  it('returns an increasing count for repeated incrs within the window', async () => {
    const fake = makeFakeRedis();
    const store = new RedisRateLimitStore(fake);
    expect((await store.incr('k', 1000, 0)).count).toBe(1);
    expect((await store.incr('k', 1000, 100)).count).toBe(2);
    expect((await store.incr('k', 1000, 200)).count).toBe(3);
  });

  it('trims entries older than (now - windowMs) so the window slides', async () => {
    const fake = makeFakeRedis();
    const store = new RedisRateLimitStore(fake);
    await store.incr('k', 1000, 0); // score 0
    await store.incr('k', 1000, 500); // score 500
    // At now=1200 the cutoff is 200; the score-0 entry is trimmed, score-500 survives,
    // plus the new score-1200 entry → count 2.
    const r = await store.incr('k', 1000, 1200);
    expect(r.count).toBe(2);
  });

  it('issues the sliding-window op sequence (trim → add → count → expire)', async () => {
    const fake = makeFakeRedis();
    const store = new RedisRateLimitStore(fake);
    await store.incr('k', 1000, 0);
    expect(fake.ops).toEqual(['zremrangebyscore', 'zadd', 'zcard', 'pexpire']);
  });

  it('computes resetAt as now + windowMs', async () => {
    const fake = makeFakeRedis();
    const store = new RedisRateLimitStore(fake);
    const r = await store.incr('k', 1000, 250);
    expect(r.resetAt).toBe(1250);
  });

  it('isolates distinct keys', async () => {
    const fake = makeFakeRedis();
    const store = new RedisRateLimitStore(fake);
    expect((await store.incr('a', 1000, 0)).count).toBe(1);
    expect((await store.incr('b', 1000, 0)).count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Env validation + store selection.
// ---------------------------------------------------------------------------
describe('resolveRateLimitRedisUrl (validated env)', () => {
  it('returns undefined when RATE_LIMIT_REDIS_URL is absent (default path)', () => {
    expect(resolveRateLimitRedisUrl({})).toBeUndefined();
  });

  it('returns undefined for an empty/whitespace value', () => {
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: '' })).toBeUndefined();
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: '   ' })).toBeUndefined();
  });

  it('accepts a redis:// URL', () => {
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: 'redis://localhost:6379' })).toBe(
      'redis://localhost:6379'
    );
  });

  it('accepts a rediss:// (TLS) URL', () => {
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: 'rediss://cache.internal:6380' })).toBe(
      'rediss://cache.internal:6380'
    );
  });

  it('rejects a non-redis URL (fail closed → undefined, default in-memory)', () => {
    expect(
      resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: 'http://localhost:6379' })
    ).toBeUndefined();
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: 'not-a-url' })).toBeUndefined();
  });
});

describe('selectRateLimitStore', () => {
  it('selects the in-memory store when RATE_LIMIT_REDIS_URL is absent (CI/gate default)', () => {
    const store = selectRateLimitStore({});
    expect(store).toBeInstanceOf(InMemoryRateLimitStore);
  });

  it('selects the in-memory store for an invalid Redis URL (fail closed)', () => {
    const store = selectRateLimitStore({ RATE_LIMIT_REDIS_URL: 'http://nope' });
    expect(store).toBeInstanceOf(InMemoryRateLimitStore);
  });

  it('selects the Redis store when a valid URL is present and a client factory is injected', () => {
    const fake = makeFakeRedis();
    const createClient = vi.fn((url: string): RedisLike => {
      expect(url).toBe('redis://localhost:6379');
      return fake;
    });
    const store = selectRateLimitStore(
      { RATE_LIMIT_REDIS_URL: 'redis://localhost:6379' },
      createClient
    );
    expect(store).toBeInstanceOf(RedisRateLimitStore);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('does NOT construct a client when no Redis URL is present (no live connection in tests)', () => {
    const createClient = vi.fn();
    selectRateLimitStore({}, createClient as unknown as (url: string) => RedisLike);
    expect(createClient).not.toHaveBeenCalled();
  });
});
