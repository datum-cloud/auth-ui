import * as transport from '../transport';
import { describe, it, expect, vi, afterEach } from 'vitest';

// A trivial DescService stand-in — createServiceClient reads `.typeName` for the cache key;
// makeAnyClient iterates `.methods` to build the client shape.
const FakeService = { typeName: 'test.Svc', methods: [] } as unknown as Parameters<
  typeof transport.createServiceClient
>[0];

afterEach(() => vi.restoreAllMocks());

describe('transport client cache', () => {
  it('does not grow unbounded across many distinct session tokens', () => {
    // 500 unique tokens must not create 500 retained clients.
    for (let i = 0; i < 500; i++) {
      transport.createServiceClient(FakeService, `tok-${i}`, 'https://z.test');
    }
    expect(transport.__cacheSize()).toBeLessThanOrEqual(transport.__CACHE_MAX());
  });

  it("a rotated token does not reuse the previous token's client", () => {
    const a = transport.createServiceClient(FakeService, 'tok-A', 'https://z.test');
    const b = transport.createServiceClient(FakeService, 'tok-B', 'https://z.test');
    expect(a).not.toBe(b);
  });

  it('the same token returns the same cached client (reuse preserved)', () => {
    const a = transport.createServiceClient(FakeService, 'tok-same', 'https://z.test');
    const b = transport.createServiceClient(FakeService, 'tok-same', 'https://z.test');
    expect(a).toBe(b);
  });
});
