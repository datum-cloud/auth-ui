// cypress/component/resources/authorize/default-org-fallback.cy.ts
//
// /authorize must thread an organization into its bootstrap redirect even when the OIDC request
// carries no org-id scope (Datum's requests don't). resolveOidc now resolves org-first with a
// default-org fallback (scope org → env pin → provider default org) and hands it to decideAuthorize,
// so the /login redirect carries `organization=<default>` instead of dropping it (which rendered
// the INSTANCE/default IdPs). An explicit scope org still wins. Node-bound: resolveAuthorize reads a
// real Request + the seeded fake provider.
import { callService } from '../../../support/node/call-service';

describe('/authorize — org-first / default-org fallback', () => {
  it('an OIDC request with NO org-id scope → the /login redirect carries the default org', () => {
    callService({
      fn: 'resolveAuthorize',
      seed: {
        authRequests: { req1: { id: 'req1', scopes: ['openid'], prompt: [] } },
        defaultOrgId: 'org-default-fake',
      },
      request: { url: 'http://localhost/id/authorize?authRequest=req1' },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.contain('/login');
      expect(loc).to.contain('requestId=oidc_req1');
      expect(loc).to.contain('organization=org-default-fake');
    });
  });

  it('an OIDC request WITH an org-id scope → the scope org wins (provider default unused)', () => {
    callService({
      fn: 'resolveAuthorize',
      seed: {
        authRequests: {
          req2: { id: 'req2', scopes: ['openid', 'urn:zitadel:iam:org:id:99999'], prompt: [] },
        },
        defaultOrgId: 'should-not-appear',
      },
      request: { url: 'http://localhost/id/authorize?authRequest=req2' },
    }).then((v) => {
      const loc = v.response?.location ?? '';
      expect(loc).to.contain('organization=99999');
      expect(loc).to.not.contain('should-not-appear');
    });
  });
});
