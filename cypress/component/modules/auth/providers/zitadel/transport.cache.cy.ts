// cypress/component/modules/auth/providers/zitadel/transport.cache.cy.ts
//
// Component (no-mount) port of transport.cache.test.ts.
//
// All three tests run via cy.task so the REAL transport.ts code executes in Bun:
//   • Real SHA-256 fingerprinting (node:crypto)
//   • Real createServiceClient → createClientFor (with SessionService, a proper DescService)
//   • Real LRU cap (CACHE_MAX=256) and eviction
//
// Each cy.task call spawns a fresh Bun process → module-level Maps start empty per test.
// No beforeEach/afterEach cache-reset needed.
import { callService } from '../../../../../support/node/call-service';
import type { Verdict } from '../../../../../support/node/call-service';

describe('transport client cache', () => {
  it('does not grow unbounded across many distinct session tokens', () => {
    callService({
      fn: 'transportCacheCheck',
      transportOp: 'clientCacheCap',
      request: { url: 'https://z.test' },
    }).then((v: Verdict) => {
      const { size, max } = v.outcome as { size: number; max: number };
      expect(size).to.be.at.most(max);
    });
  });

  it("a rotated token does not reuse the previous token's client", () => {
    callService({
      fn: 'transportCacheCheck',
      transportOp: 'clientCacheRotatedToken',
      request: { url: 'https://z.test' },
    }).then((v: Verdict) => {
      expect((v.outcome as { distinct: boolean }).distinct).to.equal(true);
    });
  });

  it('the same token returns the same cached client (reuse preserved)', () => {
    callService({
      fn: 'transportCacheCheck',
      transportOp: 'clientCacheSameToken',
      request: { url: 'https://z.test' },
    }).then((v: Verdict) => {
      expect((v.outcome as { reused: boolean }).reused).to.equal(true);
    });
  });
});
