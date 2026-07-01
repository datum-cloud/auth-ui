// cypress/component/resources/sso/default-org-fallback.cy.ts
//
// Part 2 of the org-first / default-org fallback fix: the SSO IdP-DISPLAY flows. Before this fix the
// SSO flows called `provider.getActiveIdPs(organization)` with a RAW org — empty when the SSO-link is
// entered without `?organization=` — so they fell back to the INSTANCE/default IdPs (the wrong
// duplicates) instead of the Datum Cloud ORG IdPs. Every display read now routes through the single
// `getActiveIdPs` choke point (app/resources/sso/idp-providers.ts), which resolves the org org-first
// with a default-org fallback: an explicit org (URL/payload) WINS, an empty one falls back to the
// provider's instance Default Organization ('org-default-fake' on the seeded fake). Node-bound: each
// flow reads a real Request + the seeded fake provider; recordCalls captures the org arg.
import { callService } from '../../../support/node/call-service';

const RECORD = ['getDefaultOrg', 'getActiveIdPs'] as const;

describe('SSO IdP-display flows — org-first / default-org fallback', () => {
  describe('idp-providers wrapper (the choke point)', () => {
    it('with NO org, threads the resolved default org into getActiveIdPs (not undefined)', () => {
      callService({
        fn: 'activeIdPsProbe',
        provider: 'singleton',
        request: { url: 'http://localhost/id/sso' },
        recordCalls: [...RECORD],
      }).then((v) => {
        expect(v.calls?.getDefaultOrg).to.have.length(1);
        expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-default-fake');
      });
    });
  });

  describe('runSsoAction (start intent)', () => {
    it('with NO organization, resolves the default org for the active-IdP lookup', () => {
      callService({
        fn: 'runSsoAction',
        provider: 'singleton',
        request: { url: 'http://localhost/id/sso', form: { intent: 'start', provider: 'google' } },
        recordCalls: [...RECORD],
      }).then((v) => {
        expect(v.calls?.getDefaultOrg).to.have.length(1);
        expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-default-fake');
      });
    });
  });
});
