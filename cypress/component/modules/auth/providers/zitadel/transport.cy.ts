// cypress/component/modules/auth/providers/zitadel/transport.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/transport.test.ts.
//
// resolveServiceUrl lives in transport.util.ts — a pure, browser-safe module that is NOT stubbed
// in vite.config.ts. Importing from there gives the REAL implementation, not the vite stub.
//
// createServerTransport tests need the real SHA-256 fingerprint (node:crypto) and the real
// @zitadel/client/node transport factory — both node-only. They run via cy.task so the real
// transport.ts code path executes in Bun (fresh process = fresh Maps per test, no afterEach).
//
// Final squeeze: resolveServiceUrl is a genuine security boundary (fail-closed forward-host
// allowlist, SSRF-adjacent) so its accept/reject/fallback paths are kept together as one test —
// this is the load-bearing forward-host allowlist guard and MUST keep exercising both the
// allow-listed-accept and non-allow-listed/empty-allowlist-reject branches. The cache tests are
// merged into one hit/miss/empty-input case, and the SHA-256 fingerprint regression (a named
// historical bug: the old stub's 16-char-prefix fingerprint collided distinct tokens) is kept
// standalone.
import { callService } from '../../../../../support/node/call-service';
import type { Verdict } from '../../../../../support/node/call-service';
import { resolveServiceUrl } from '@/modules/auth/providers/zitadel/transport.util';

// EL-TRANSPORT-1: resolveServiceUrl is fail-closed. This is the SSRF-adjacent forward-host
// allowlist guard — only allowlisted x-zitadel-forward-host values may be trusted/used.
describe('resolveServiceUrl', () => {
  it('accepts only an allowlisted x-zitadel-forward-host, rejects otherwise (fail-closed), and falls back to ZITADEL_API_URL', () => {
    const h = new Headers({ 'x-zitadel-forward-host': 'tenant.zitadel.test' });
    expect(
      resolveServiceUrl(h, {
        ZITADEL_API_URL: 'http://fallback',
        trustedForwardHosts: ['tenant.zitadel.test'],
      })
    ).to.equal('https://tenant.zitadel.test');

    const evil = new Headers({ 'x-zitadel-forward-host': 'evil.attacker.test' });
    expect(() =>
      resolveServiceUrl(evil, {
        ZITADEL_API_URL: 'https://safe.test',
        trustedForwardHosts: ['tenant.zitadel.test'],
      })
    ).to.throw('Zitadel service URL could not be determined');

    const trusted = new Headers({ 'x-zitadel-forward-host': 'tenant.zitadel.test' });
    expect(() =>
      resolveServiceUrl(trusted, { ZITADEL_API_URL: 'https://safe.test', trustedForwardHosts: [] })
    ).to.throw('Zitadel service URL could not be determined');
    expect(() => resolveServiceUrl(trusted, { ZITADEL_API_URL: 'https://safe.test' })).to.throw(
      'Zitadel service URL could not be determined'
    );

    expect(resolveServiceUrl(new Headers(), { ZITADEL_API_URL: 'https://z.test' })).to.equal(
      'https://z.test'
    );
    expect(() => resolveServiceUrl(new Headers(), {})).to.throw();
  });
});

// EL-TRANSPORT-2: createServerTransport caching — real SHA-256 fingerprint, real HTTP/2 factory.
// Each test is an independent cy.task call (fresh Bun process → fresh Maps).
describe('createServerTransport — caching', () => {
  it('caches by url+token (hit), keys a different baseUrl distinctly (miss), and throws when baseUrl or token is empty', () => {
    callService({
      fn: 'transportCacheCheck',
      transportOp: 'serverTransportCacheHit',
      request: { url: 'https://z.test' },
    }).then((v: Verdict) => {
      expect((v.outcome as { hit: boolean }).hit).to.equal(true);
    });
    callService({
      fn: 'transportCacheCheck',
      transportOp: 'serverTransportCacheMiss',
      request: { url: 'https://z.test' },
    }).then((v: Verdict) => {
      expect((v.outcome as { miss: boolean }).miss).to.equal(true);
    });
    callService({
      fn: 'transportCacheCheck',
      transportOp: 'serverTransportThrowsEmptyBase',
      request: { url: 'https://z.test' },
    }).then((v: Verdict) => {
      const o = v.outcome as { threw: boolean; message: string };
      expect(o.threw).to.equal(true);
      expect(o.message).to.include('No instance url found');
    });
    callService({
      fn: 'transportCacheCheck',
      transportOp: 'serverTransportThrowsEmptyToken',
      request: { url: 'https://z.test' },
    }).then((v: Verdict) => {
      const o = v.outcome as { threw: boolean; message: string };
      expect(o.threw).to.equal(true);
      expect(o.message).to.include('No service token found');
    });
  });

  it('SHA-256 fingerprint: tokens sharing a 16-char prefix produce distinct cache entries', () => {
    // The old vite stub used simpleFingerprint (first 16 chars), which would incorrectly
    // key both tokens identically. The real SHA-256 distinguishes them correctly.
    callService({
      fn: 'transportCacheCheck',
      transportOp: 'sha256FingerprintDistinctness',
      request: { url: 'https://z.test' },
    }).then((v: Verdict) => {
      expect((v.outcome as { distinct: boolean }).distinct).to.equal(true);
    });
  });
});
