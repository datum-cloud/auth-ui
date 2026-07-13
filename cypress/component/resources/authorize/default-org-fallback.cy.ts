// cypress/component/resources/authorize/default-org-fallback.cy.ts
//
// /authorize must thread ONLY the explicit OIDC-scope org into its bootstrap redirect.
// When the OIDC request carries no org-id scope, no `organization=` is threaded — the
// default-org fallback is a /login display concern, not an /authorize ceremony concern.
// An explicit `urn:zitadel:iam:org:id:<digits>` scope always threads that org verbatim.
// Node-bound: resolveAuthorize reads a real Request + the seeded fake provider.
import { callService } from '../../../support/node/call-service';

describe('/authorize — explicit-only org threading', () => {
  it('does NOT thread an organization into /login when the OIDC request carries no org scope', () => {
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
      expect(loc).to.not.contain('organization='); // explicit-only → absent for a no-org request
    });
  });

  it('threads the explicit org scope into /login when the OIDC request carries an org-id scope', () => {
    callService({
      fn: 'resolveAuthorize',
      seed: {
        authRequests: {
          req2: {
            id: 'req2',
            scopes: ['openid', 'urn:zitadel:iam:org:id:99999'],
            prompt: [],
          },
        },
        defaultOrgId: 'org-default-fake',
      },
      request: { url: 'http://localhost/id/authorize?authRequest=req2' },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.contain('/login');
      expect(loc).to.contain('organization=99999');
    });
  });
});
