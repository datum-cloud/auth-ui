// cypress/component/resources/authorize/saml.cy.ts
//
// cy.task node-spec port of app/resources/authorize/__tests__/saml.test.ts. The SAML branch of
// /authorize gates on a signed `sessions` cookie, so it must run node-side. Stateless hand-off:
// validate → gate on session → 302 to the BFF /sso/saml-post (no response generated, no cookie).
import { callService } from '../../../support/node/call-service';

describe('/authorize — SAML branch (stateless hand-off)', () => {
  it('WITHOUT session → 302 to /login carrying requestId=saml_sr-1', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      request: { url: 'http://localhost/id/authorize?samlRequest=sr-1' },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.include('requestId=saml_sr-1');
    });
  });
});
