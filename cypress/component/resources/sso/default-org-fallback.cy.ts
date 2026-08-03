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
  // Both flows assert the identical two-call shape, differing only by which entry point
  // drives the choke point. Chained in one test; each callService spawns a fresh Bun
  // process, so the two remain independent.
  it('resolves the default org for the active-IdP lookup on both entry points', () => {
    callService({
      fn: 'activeIdPsProbe',
      provider: 'singleton',
      request: { url: 'http://localhost/id/sso' },
      recordCalls: [...RECORD],
    })
      .then((v) => {
        expect(v.calls?.getDefaultOrg, 'activeIdPsProbe: getDefaultOrg called once').to.have.length(
          1
        );
        expect(
          v.calls?.getActiveIdPs?.[0]?.[0],
          'activeIdPsProbe: resolved org threaded through'
        ).to.equal('org-default-fake');
        return callService({
          fn: 'runSsoAction',
          provider: 'singleton',
          request: {
            url: 'http://localhost/id/sso',
            form: { intent: 'start', provider: 'google' },
          },
          recordCalls: [...RECORD],
        });
      })
      .then((v) => {
        expect(v.calls?.getDefaultOrg, 'runSsoAction: getDefaultOrg called once').to.have.length(1);
        expect(
          v.calls?.getActiveIdPs?.[0]?.[0],
          'runSsoAction: resolved org threaded through'
        ).to.equal('org-default-fake');
      });
  });
});
