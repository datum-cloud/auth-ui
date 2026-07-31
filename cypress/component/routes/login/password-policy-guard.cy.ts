// cypress/component/routes/login/password-policy-guard.cy.ts
//
// Org policy can disable password sign-in (Zitadel LoginPolicy.userLogin=false →
// settings.allowPassword=false; that is production's configuration today).
// decideAfterIdentifier already filters password out of the post-identifier routing, but
// auth-ui drives Zitadel through the headless Session API — LoginPolicy governs Zitadel's
// own hosted UI, not us. So /login/password must refuse on its own, or a direct navigation
// (loader) or crafted POST (action) still reaches a working password check.
import { callService } from '../../../support/node/call-service';

describe('/login/password — allowPassword policy guard', () => {
  it('loader bounces a direct visit back to /login when password is disabled', () => {
    callService({
      fn: 'loginPasswordLoader',
      provider: 'singleton',
      mockLoginSettings: { allowPassword: false },
      request: { url: 'http://localhost/id/login/password' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.contain('/login');
    });
  });

  it('action refuses a crafted POST when password is disabled', () => {
    callService({
      fn: 'loginPasswordAction',
      provider: 'singleton',
      mockLoginSettings: { allowPassword: false },
      request: {
        url: 'http://localhost/id/login/password',
        form: { loginName: 'user@acme.test', password: 'hunter2hunter2' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(403);
      expect(v.response?.dataBody).to.have.property('error', 'PASSWORD_NOT_ALLOWED');
    });
  });

  it('loader renders normally when password is allowed', () => {
    callService({
      fn: 'loginPasswordLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login/password' },
    }).then((v) => {
      expect(v.response?.status).to.not.equal(302);
    });
  });
});
