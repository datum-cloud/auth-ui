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
import { callService } from '../../../../../support/node/call-service';
import type { Verdict } from '../../../../../support/node/call-service';
import { resolveServiceUrl } from '@/modules/auth/providers/zitadel/transport.util';

// EL-TRANSPORT-1: resolveServiceUrl is fail-closed.
describe('resolveServiceUrl', () => {
  it('accepts x-zitadel-forward-host when allowlisted (https-normalized)', () => {
    const h = new Headers({ 'x-zitadel-forward-host': 'tenant.zitadel.test' });
    expect(
      resolveServiceUrl(h, {
        ZITADEL_API_URL: 'http://fallback',
        trustedForwardHosts: ['tenant.zitadel.test'],
      })
    ).to.equal('https://tenant.zitadel.test');
  });
  it('accepts an already-https forward host when allowlisted', () => {
    const h = new Headers({ 'x-zitadel-forward-host': 'https://tenant.zitadel.test' });
    expect(resolveServiceUrl(h, { trustedForwardHosts: ['tenant.zitadel.test'] })).to.equal(
      'https://tenant.zitadel.test'
    );
  });
  it('rejects x-zitadel-forward-host when NOT in allowlist (fail-closed)', () => {
    const h = new Headers({ 'x-zitadel-forward-host': 'evil.attacker.test' });
    expect(() =>
      resolveServiceUrl(h, {
        ZITADEL_API_URL: 'https://safe.test',
        trustedForwardHosts: ['tenant.zitadel.test'],
      })
    ).to.throw('Zitadel service URL could not be determined');
  });
  it('rejects x-zitadel-forward-host when trustedForwardHosts is empty (fail-closed)', () => {
    const h = new Headers({ 'x-zitadel-forward-host': 'tenant.zitadel.test' });
    expect(() =>
      resolveServiceUrl(h, { ZITADEL_API_URL: 'https://safe.test', trustedForwardHosts: [] })
    ).to.throw('Zitadel service URL could not be determined');
  });
  it('rejects x-zitadel-forward-host when trustedForwardHosts is absent (fail-closed default)', () => {
    const h = new Headers({ 'x-zitadel-forward-host': 'tenant.zitadel.test' });
    expect(() => resolveServiceUrl(h, { ZITADEL_API_URL: 'https://safe.test' })).to.throw(
      'Zitadel service URL could not be determined'
    );
  });
  it('falls back to ZITADEL_API_URL when no forward-host header present', () => {
    expect(resolveServiceUrl(new Headers(), { ZITADEL_API_URL: 'https://z.test' })).to.equal(
      'https://z.test'
    );
  });
  it('throws when nothing resolves', () => {
    expect(() => resolveServiceUrl(new Headers(), {})).to.throw();
  });
});

// EL-TRANSPORT-2: createServerTransport caching — real SHA-256 fingerprint, real HTTP/2 factory.
// Each test is an independent cy.task call (fresh Bun process → fresh Maps).
describe('createServerTransport — caching', () => {
  it('returns the same object reference for the same url+token (cache hit)', () => {
    callService({
      fn: 'transportCacheCheck',
      transportOp: 'serverTransportCacheHit',
      request: { url: 'https://z.test' },
    }).then((v: Verdict) => {
      expect((v.outcome as { hit: boolean }).hit).to.equal(true);
    });
  });
  it('returns a different object for a different baseUrl (distinct cache entry)', () => {
    callService({
      fn: 'transportCacheCheck',
      transportOp: 'serverTransportCacheMiss',
      request: { url: 'https://z.test' },
    }).then((v: Verdict) => {
      expect((v.outcome as { miss: boolean }).miss).to.equal(true);
    });
  });
  it('throws when baseUrl is empty', () => {
    callService({
      fn: 'transportCacheCheck',
      transportOp: 'serverTransportThrowsEmptyBase',
      request: { url: 'https://z.test' },
    }).then((v: Verdict) => {
      const o = v.outcome as { threw: boolean; message: string };
      expect(o.threw).to.equal(true);
      expect(o.message).to.include('No instance url found');
    });
  });
  it('throws when token is empty', () => {
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
