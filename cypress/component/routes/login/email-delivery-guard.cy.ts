// cypress/component/routes/login/email-delivery-guard.cy.ts
//
// cy.task port of app/routes/login/__tests__/email-delivery-guard.test.ts.
// Defense-in-depth: the /login action must reject intent=email-link with 400 INVALID_INPUT
// when AUTH_EMAIL_DELIVERY_ENABLED=false, even if the UI already hides the button.
// Default env has AUTH_EMAIL_DELIVERY_ENABLED=false (the fail-safe default).
import { callService } from '../../../support/node/call-service';

describe('login action — email-link guard when delivery is off', () => {
  it('returns 400 INVALID_INPUT when AUTH_EMAIL_DELIVERY_ENABLED=false and intent=email-link', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      // AUTH_EMAIL_DELIVERY_ENABLED defaults to false in the env schema (fail-safe).
      // Explicitly set false to be unambiguous.
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'false' },
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: 'email-otp-user@acme.test', intent: 'email-link' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'INVALID_INPUT');
    });
  });
});
