// cypress/component/server/middleware/rate-limit-store.cy.ts
// COMPONENT port of app/server/middleware/__tests__/rate-limit-store.test.ts
// All DI — no live Redis; vi.fn() replaced with plain function tracking.
// Reduced to the core "limit enforced" + "limit resets" + one store-backend behavior per the
// rate-limiting abuse-prevention control, plus the fail-closed Redis-URL/selection defaults.
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
// InMemoryRateLimitStore — window enforcement + reset
// ---------------------------------------------------------------------------
describe('InMemoryRateLimitStore (default adapter)', () => {
  it('expires + restarts the window once windowMs elapses', () => {
    const store = new InMemoryRateLimitStore();
    expect(store.incr('k', 1000, 0).count).to.equal(1);
    expect(store.incr('k', 1000, 500).count).to.equal(2);
    const fresh = store.incr('k', 1000, 1000);
    expect(fresh.count).to.equal(1);
    expect(fresh.resetAt).to.equal(2000);
  });
});

// ---------------------------------------------------------------------------
// RateLimiter delegates to the in-memory store — limit enforced
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
});

// ---------------------------------------------------------------------------
// RedisRateLimitStore (fake client, no live server) — one store-backend behavior
// ---------------------------------------------------------------------------
describe('RedisRateLimitStore (ioredis sliding-window adapter, fake client)', () => {
  it('issues the sliding-window op sequence (trim → add → count → expire)', async () => {
    const fake = makeFakeRedis();
    const store = new RedisRateLimitStore(fake);
    await store.incr('k', 1000, 0);
    expect(fake.ops).to.deep.equal(['zremrangebyscore', 'zadd', 'zcard', 'pexpire']);
  });
});

// ---------------------------------------------------------------------------
// resolveRateLimitRedisUrl — fail-closed default
// ---------------------------------------------------------------------------
describe('resolveRateLimitRedisUrl (validated env)', () => {
  it('rejects a non-redis URL (fail closed → undefined, default in-memory)', () => {
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: 'http://localhost:6379' })).to.be
      .undefined;
    expect(resolveRateLimitRedisUrl({ RATE_LIMIT_REDIS_URL: 'not-a-url' })).to.be.undefined;
  });
});

// ---------------------------------------------------------------------------
// selectRateLimitStore — fail-closed default
// ---------------------------------------------------------------------------
describe('selectRateLimitStore', () => {
  it('selects the in-memory store for an invalid Redis URL (fail closed)', () => {
    const store = selectRateLimitStore({ RATE_LIMIT_REDIS_URL: 'http://nope' });
    expect(store).to.be.instanceOf(InMemoryRateLimitStore);
  });
});
