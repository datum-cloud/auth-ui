// cypress/component/routes/login/default-org-fallback.cy.ts
//
// The login loader (app/routes/login/index.tsx) must resolve the org org-first with a default-org
// fallback: without an explicit ?organization it now threads the provider's instance Default
// Organization into getLoginSettings / getActiveIdPs (was undefined → INSTANCE/default IdPs). Node-
// bound because the loader reads the real provider singleton + signed cookies. recordCalls captures
// the org arg the loader passed to each provider read.
import { callService } from '../../../support/node/call-service';

describe('login loader — org-first / default-org fallback', () => {
  it('with NO ?organization, calls getLoginSettings + getActiveIdPs with the resolved default org (not undefined)', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login' },
      recordCalls: ['getDefaultOrg', 'getLoginSettings', 'getActiveIdPs'],
    }).then((v) => {
      // the provider default-org lookup ran exactly once (memoized)
      expect(v.calls?.getDefaultOrg).to.have.length(1);
      // and threaded into BOTH the settings + IdP reads instead of undefined
      expect(v.calls?.getLoginSettings?.[0]?.[0]).to.equal('org-default-fake');
      expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-default-fake');
    });
  });

  it('with an explicit ?organization=, uses it and never consults the provider default org', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login?organization=org-explicit' },
      recordCalls: ['getDefaultOrg', 'getLoginSettings', 'getActiveIdPs'],
    }).then((v) => {
      expect(v.calls?.getDefaultOrg).to.have.length(0);
      expect(v.calls?.getLoginSettings?.[0]?.[0]).to.equal('org-explicit');
      expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-explicit');
    });
  });
});
