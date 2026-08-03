// cypress/component/resources/authorize/default-org-fallback.cy.ts
//
// /authorize must thread ONLY the explicit OIDC-scope org into its bootstrap redirect.
// When the OIDC request carries no org-id scope, no `organization=` is threaded — the
// default-org fallback is a /login display concern, not an /authorize ceremony concern.
// An explicit `urn:zitadel:iam:org:id:<digits>` scope always threads that org verbatim.
// Node-bound: resolveAuthorize reads a real Request + the seeded fake provider.
import { callService } from '../../../support/node/call-service';

describe('/authorize — explicit-only org threading', () => {
  it('threads only an explicit org-id scope into /login', () => {
    callService({
      fn: 'resolveAuthorize',
      seed: {
        authRequests: { req1: { id: 'req1', scopes: ['openid'], prompt: [] } },
        defaultOrgId: 'org-default-fake',
      },
      request: { url: 'http://localhost/id/authorize?authRequest=req1' },
    }).then((v) => {
      expect(v.response?.status, 'no org scope: status').to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc, 'no org scope: bootstraps /login').to.contain('/login');
      expect(loc, 'no org scope: requestId threaded').to.contain('requestId=oidc_req1');
      // explicit-only → the seeded default org must NOT leak in here.
      expect(loc, 'no org scope: organization absent').to.not.contain('organization=');
    });

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
      expect(v.response?.status, 'explicit org scope: status').to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc, 'explicit org scope: bootstraps /login').to.contain('/login');
      expect(loc, 'explicit org scope: threaded verbatim').to.contain('organization=99999');
    });
  });
});
