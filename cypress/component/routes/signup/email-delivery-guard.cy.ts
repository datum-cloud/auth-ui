// cypress/component/routes/signup/email-delivery-guard.cy.ts
//
// cy.task port of app/routes/signup/__tests__/email-delivery-guard.test.ts.
// Defense-in-depth: the signup/method action must reject intent=email-link with 400
// INVALID_INPUT when AUTH_EMAIL_DELIVERY_ENABLED=false, even if the UI hides the button.
import { callService } from '../../../support/node/call-service';

const IDENTITY = {
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
};

describe('signup/method action — email-link guard when delivery is off', () => {
  it('returns 400 INVALID_INPUT when AUTH_EMAIL_DELIVERY_ENABLED=false and intent=email-link', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'false' },
      request: {
        url: 'http://localhost/id/signup/method',
        form: { intent: 'email-link', ...IDENTITY },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'INVALID_INPUT');
    });
  });

  // Phase B: after the collapse the guard covers the passkey intent too — passkey signup
  // genuinely requires mail now (the verification link IS the flow). Task 1 decoupled only
  // showPasskey (display); this server-side guard is the enforcement.
  it('returns 400 INVALID_INPUT for BOTH email-link and passkey intents when delivery is off', () => {
    for (const intent of ['email-link', 'passkey'] as const) {
      callService({
        fn: 'signupMethodAction',
        provider: 'singleton',
        env: { AUTH_EMAIL_DELIVERY_ENABLED: 'false' },
        request: {
          url: 'http://localhost/id/signup/method',
          form: { intent, ...IDENTITY },
          csrf: true,
        },
      }).then((v) => {
        expect(v.response?.isResponse, intent).to.equal(false);
        expect(v.response?.dataStatus, intent).to.equal(400);
        expect(v.response?.dataBody, intent).to.have.property('error', 'INVALID_INPUT');
      });
    }
  });

  it('still allows intent=password when delivery is off', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'false' },
      request: {
        url: 'http://localhost/id/signup/method',
        form: { intent: 'password', ...IDENTITY },
        csrf: true,
      },
    }).then((v) => {
      // password intent redirects to /signup/password — never a 400
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
    });
  });
});
