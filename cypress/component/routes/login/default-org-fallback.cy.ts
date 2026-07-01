// cypress/component/routes/login/default-org-fallback.cy.ts
//
// The login loader (app/routes/login/index.tsx) resolves the org org-first with a default-org
// fallback. A1 (org-first thread-in): a bare /login (no ?organization) now REDIRECTS to the same
// URL with `?organization=<resolved default>` added, so the org threads into every downstream
// ceremony screen at once (mirrors how /authorize threads it) instead of running instance/default
// after screen 1. Node-bound: the loader reads the real provider singleton + signed cookies;
// recordCalls captures the org arg each provider read received.
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
});
