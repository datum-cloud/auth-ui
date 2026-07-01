// cypress/component/routes/login/last-used-login-loader.cy.ts
//
// cy.task node-spec port of app/routes/login/__tests__/last-used-login-loader.test.ts.
//
// The /login loader threads the last-used-login cookie value into its returned data object.
// The cookie is HMAC-signed (react-router createCookie), so the harness uses the real
// serializeLastUsedLogin (via RequestSpec.lastUsedLogin) to build an authentic cookie.
// NOTE: an explicit ?organization is threaded so the loader RENDERS — a bare /login now
// redirects (A1 org-first thread-in) before returning data, which would hide dataBody.
import { callService } from '../../../support/node/call-service';

describe('/login loader — lastUsedLogin threading', () => {
  it('returns lastUsedLogin="idp:google" when the cookie contains "idp:google"', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login?organization=org1', lastUsedLogin: 'idp:google' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataBody).to.have.property('lastUsedLogin', 'idp:google');
    });
  });
});
