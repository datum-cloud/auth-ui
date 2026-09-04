// cypress/component/routes/signup/email-delivery-guard.cy.ts
//
// cy.task port of app/routes/signup/__tests__/email-delivery-guard.test.ts.
// Defense-in-depth: the signup/method action must reject the passkey intent with 400
// INVALID_INPUT when AUTH_EMAIL_DELIVERY_ENABLED=false, even if the UI hides the button —
// passkey signup genuinely requires mail (the verification link IS the flow).
import { callService } from '../../../support/node/call-service';

const IDENTITY = {
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
};

describe('signup/method action — passkey guard when delivery is off', () => {
  it('returns 400 INVALID_INPUT when AUTH_EMAIL_DELIVERY_ENABLED=false', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'false' },
      request: {
        url: 'http://localhost/id/signup/method',
        form: { intent: 'passkey', ...IDENTITY },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'INVALID_INPUT');
    });
  });

  // Signup is passkey-only, so with delivery off there is NO intent left that completes. The
  // retired 'password' intent used to be the escape hatch here ("still allows intent=password
  // when delivery is off"); it must now fail closed like everything else rather than quietly
  // remaining the one way to create an account on a mail-less deployment.
  it('leaves no intent that still creates an account when delivery is off', () => {
    for (const intent of ['passkey', 'email-link', 'password'] as const) {
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
        expect(v.response?.isResponse, `${intent}: must not redirect`).to.equal(false);
        expect(v.response?.dataStatus, intent).to.equal(400);
        expect(v.response?.dataBody, intent).to.have.property('error', 'INVALID_INPUT');
      });
    }
  });
});
