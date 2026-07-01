// cypress/component/routes/login/default-org-fallback.cy.ts
//
// The login loader (app/routes/login/index.tsx) resolves the org org-first with a default-org
// fallback. A1 (org-first thread-in): a bare /login (no ?organization) now REDIRECTS to the same
// URL with `?organization=<resolved default>` added, so the org threads into every downstream
// ceremony screen at once (mirrors how /authorize threads it) instead of running instance/default
// after screen 1. Once the param is present the loader renders and threads that org into
// getLoginSettings / getBranding / getActiveIdPs. Node-bound: the loader reads the real provider
// singleton + signed cookies; recordCalls captures the org arg each provider read received.
import { callService } from '../../../support/node/call-service';

describe('login loader — A1 org-first thread-in + default-org fallback', () => {
  it('bare /login (no ?organization) → 302 that ADDS ?organization=<default org>, before any settings read', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login' },
      recordCalls: ['getDefaultOrg', 'getLoginSettings', 'getBranding', 'getActiveIdPs'],
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.contain('/login');
      expect(loc).to.contain('organization=org-default-fake');
      // resolveOrg consulted the provider default exactly once; the settings/branding/IdP reads
      // happen on the REDIRECTED request (which now carries the org), NOT on this one.
      expect(v.calls?.getDefaultOrg).to.have.length(1);
      expect(v.calls?.getLoginSettings ?? []).to.have.length(0);
      expect(v.calls?.getBranding ?? []).to.have.length(0);
    });
  });

  it('with an explicit ?organization=, does NOT redirect and threads it into settings + branding + IdP reads (provider default never consulted)', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login?organization=org-explicit' },
      recordCalls: ['getDefaultOrg', 'getLoginSettings', 'getBranding', 'getActiveIdPs'],
    }).then((v) => {
      // param present → loop guard blocks the A1 redirect: the loader renders a data() object.
      expect(v.response?.isResponse).to.equal(false);
      expect(v.calls?.getDefaultOrg).to.have.length(0);
      expect(v.calls?.getLoginSettings?.[0]?.[0]).to.equal('org-explicit');
      expect(v.calls?.getBranding?.[0]?.[0]).to.equal('org-explicit');
      expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-explicit');
    });
  });

  it('the REDIRECTED request (org already = the default) renders and does NOT redirect again (no loop)', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login?organization=org-default-fake' },
      recordCalls: ['getLoginSettings', 'getBranding'],
    }).then((v) => {
      // param present → no second redirect; the loader renders and the reads carry the threaded org.
      // This proves the loop guard: the redirected request never redirects again. (The guard's other
      // arm — no redirect when resolveOrg returns undefined — is the same `&&` short-circuit; it can't
      // be exercised through this route loader because providerForRequest always returns the seeded
      // singleton, which HAS a default org. resolveOrg's undefined branch is pinned by resolveOrgProbe.)
      expect(v.response?.isResponse).to.equal(false);
      expect(v.calls?.getLoginSettings?.[0]?.[0]).to.equal('org-default-fake');
      expect(v.calls?.getBranding?.[0]?.[0]).to.equal('org-default-fake');
    });
  });
});
