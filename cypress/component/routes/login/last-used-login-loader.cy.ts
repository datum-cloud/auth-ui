// cypress/component/routes/login/last-used-login-loader.cy.ts
//
// cy.task node-spec port of app/routes/login/__tests__/last-used-login-loader.test.ts.
//
// The /login loader threads the last-used-login cookie value into its returned data object.
// The cookie is HMAC-signed (react-router createCookie), so the harness uses the real
// serializeLastUsedLogin (via RequestSpec.lastUsedLogin) to build an authentic cookie.
import { callService } from '../../../support/node/call-service';

describe('/login loader — lastUsedLogin threading', () => {
  it('returns lastUsedLogin=null when the cookie is absent', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataBody).to.have.property('lastUsedLogin', null);
    });
  });

  it('returns lastUsedLogin="email" when the cookie contains "email"', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login', lastUsedLogin: 'email' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataBody).to.have.property('lastUsedLogin', 'email');
    });
  });

  it('returns lastUsedLogin="passkey" when the cookie contains "passkey"', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login', lastUsedLogin: 'passkey' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataBody).to.have.property('lastUsedLogin', 'passkey');
    });
  });

  it('returns lastUsedLogin="idp:google" when the cookie contains "idp:google"', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login', lastUsedLogin: 'idp:google' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataBody).to.have.property('lastUsedLogin', 'idp:google');
    });
  });
});
