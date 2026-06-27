// cypress/component/server/middleware/rate-limit-store.cy.ts
// COMPONENT port of app/server/middleware/__tests__/rate-limit-store.test.ts
// All DI — no live Redis; vi.fn() replaced with plain function tracking.
import { RateLimiter } from '@/server/middleware/rate-limit';
import {
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  resolveRateLimitRedisUrl,
  selectRateLimitStore,
  type RedisLike,
} from '@/server/middleware/rate-limit-store';

// ---------------------------------------------------------------------------
// Fake ioredis client — injected, never a live server.
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

// ---------------------------------------------------------------------------
// InMemoryRateLimitStore
// ---------------------------------------------------------------------------
describe('InMemoryRateLimitStore (default adapter)', () => {
  it('counts increments within a window', () => {
    const store = new InMemoryRateLimitStore();
    expect(store.incr('k', 1000, 0).count).to.equal(1);
    expect(store.incr('k', 1000, 100).count).to.equal(2);
    expect(store.incr('k', 1000, 200).count).to.equal(3);
  });

  it('resetAt is windowStart + windowMs and is stable across a window', () => {
    const store = new InMemoryRateLimitStore();
    const first = store.incr('k', 1000, 50);
    expect(first.resetAt).to.equal(1050); // 50 (windowStart) + 1000
    const second = store.incr('k', 1000, 400);
    expect(second.resetAt).to.equal(1050); // unchanged within the same window
  });

  it('expires + restarts the window once windowMs elapses', () => {
    const store = new InMemoryRateLimitStore();
    expect(store.incr('k', 1000, 0).count).to.equal(1);
    expect(store.incr('k', 1000, 500).count).to.equal(2);
    const fresh = store.incr('k', 1000, 1000);
    expect(fresh.count).to.equal(1);
    expect(fresh.resetAt).to.equal(2000);
  });

  it('isolates distinct keys', () => {
    const store = new InMemoryRateLimitStore();
    expect(store.incr('a', 1000, 0).count).to.equal(1);
    expect(store.incr('b', 1000, 0).count).to.equal(1);
  });

  it('sweeps expired buckets when the map exceeds the soft cap (bounded memory)', () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i <= 10_001; i++) store.incr(`k${i}`, 1000, 0);
    expect(store.size).to.be.greaterThan(10_000);
    store.incr('trigger', 1000, 10_000);
    expect(store.size).to.be.lessThan(10);
  });
});

// ---------------------------------------------------------------------------
// RateLimiter delegates to the in-memory store
// ---------------------------------------------------------------------------
describe('RateLimiter delegates to the in-memory store (default behavior unchanged)', () => {
  it('allows up to the limit, then blocks within the window', () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
    const k = 'ip|alice';
    expect(rl.check(k, 0).allowed).to.equal(true);
    expect(rl.check(k, 10).allowed).to.equal(true);
    expect(rl.check(k, 20).allowed).to.equal(true);
    const fourth = rl.check(k, 30);
    expect(fourth.allowed).to.equal(false);
    expect(fourth.retryAfterMs).to.be.greaterThan(0);
  });

  it('accepts an injected store (pluggable seam)', () => {
    const calls: Array<{ key: string; windowMs: number }> = [];
    const fake = {
      incr(key: string, windowMs: number, nowMs?: number) {
        calls.push({ key, windowMs });
        return { count: 1, resetAt: (nowMs ?? 0) + windowMs };
      },
    } as unknown as InMemoryRateLimitStore;
    const rl = new RateLimiter({ limit: 5, windowMs: 1000 }, fake);
    expect(rl.check('k', 0).allowed).to.equal(true);
    expect(calls).to.deep.equal([{ key: 'k', windowMs: 1000 }]);
  });
});

// ---------------------------------------------------------------------------
// RedisRateLimitStore (fake client, no live server)
// ---------------------------------------------------------------------------
describe('RedisRateLimitStore (ioredis sliding-window adapter, fake client)', () => {
  it('returns an increasing count for repeated incrs within the window', async () => {
    const fake = makeFakeRedis();
    const store = new RedisRateLimitStore(fake);
    expect((await store.incr('k', 1000, 0)).count).to.equal(1);
    expect((await store.incr('k', 1000, 100)).count).to.equal(2);
    expect((await store.incr('k', 1000, 200)).count).to.equal(3);
  });

  it('trims entries older than (now - windowMs) so the window slides', async () => {
    const fake = makeFakeRedis();
    const store = new RedisRateLimitStore(fake);
    await store.incr('k', 1000, 0);
    await store.incr('k', 1000, 500);
    const r = await store.incr('k', 1000, 1200);
    expect(r.count).to.equal(2);
  });

  it('issues the sliding-window op sequence (trim → add → count → expire)', async () => {
    const fake = makeFakeRedis();
    const store = new RedisRateLimitStore(fake);
    await store.incr('k', 1000, 0);
    expect(fake.ops).to.deep.equal(['zremrangebyscore', 'zadd', 'zcard', 'pexpire']);
  });

  it('computes resetAt as now + windowMs', async () => {
    const fake = makeFakeRedis();
    const store = new RedisRateLimitStore(fake);
    const r = await store.incr('k', 1000, 250);
    expect(r.resetAt).to.equal(1250);
  });

  it('isolates distinct keys', async () => {
    const fake = makeFakeRedis();
    const store = new RedisRateLimitStore(fake);
    expect((await store.incr('a', 1000, 0)).count).to.equal(1);
    expect((await store.incr('b', 1000, 0)).count).to.equal(1);
  });
});

// ---------------------------------------------------------------------------
// resolveRateLimitRedisUrl
// ---------------------------------------------------------------------------
describe('resolveRateLimitRedisUrl (validated env)', () => {
  it('returns undefined when RATE_LIMIT_REDIS_URL is absent (default path)', () => {
    expect(resolveRateLimitRedisUrl({})).to.be.undefined;
  });

  it('returns undefined for an empty/whitespace value', () => {
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: '' })).to.be.undefined;
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: '   ' })).to.be.undefined;
  });

  it('accepts a redis:// URL', () => {
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: 'redis://localhost:6379' })).to.equal(
      'redis://localhost:6379'
    );
  });

  it('accepts a rediss:// (TLS) URL', () => {
    expect(
      resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: 'rediss://cache.internal:6380' })
    ).to.equal('rediss://cache.internal:6380');
  });

  it('rejects a non-redis URL (fail closed → undefined, default in-memory)', () => {
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: 'http://localhost:6379' })).to.be
      .undefined;
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: 'not-a-url' })).to.be.undefined;
  });
});

// ---------------------------------------------------------------------------
// selectRateLimitStore
// ---------------------------------------------------------------------------
describe('selectRateLimitStore', () => {
  it('selects the in-memory store when RATE_LIMIT_REDIS_URL is absent (CI/gate default)', () => {
    const store = selectRateLimitStore({});
    expect(store).to.be.instanceOf(InMemoryRateLimitStore);
  });

  it('selects the in-memory store for an invalid Redis URL (fail closed)', () => {
    const store = selectRateLimitStore({ RATE_LIMIT_REDIS_URL: 'http://nope' });
    expect(store).to.be.instanceOf(InMemoryRateLimitStore);
  });

  it('selects the Redis store when a valid URL is present and a client factory is injected', () => {
    const fake = makeFakeRedis();
    let capturedUrl: string | undefined;
    const createClient = (url: string): RedisLike => {
      capturedUrl = url;
      return fake;
    };
    const store = selectRateLimitStore(
      { RATE_LIMIT_REDIS_URL: 'redis://localhost:6379' },
      createClient
    );
    expect(store).to.be.instanceOf(RedisRateLimitStore);
    expect(capturedUrl).to.equal('redis://localhost:6379');
  });

  it('does NOT construct a client when no Redis URL is present (no live connection in tests)', () => {
    let called = false;
    const createClient = (_url: string): RedisLike => {
      called = true;
      return makeFakeRedis();
    };
    selectRateLimitStore({}, createClient);
    expect(called).to.equal(false);
  });
});
