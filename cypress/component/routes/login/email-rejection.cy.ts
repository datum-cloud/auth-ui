// cypress/component/routes/login/email-rejection.cy.ts
//
// cy.task port of app/routes/login/__tests__/email-rejection.test.ts.
// Task 3 route-level guard: EMAIL_LOGIN_DISABLED when org disables email login.
import { callService } from '../../../support/node/call-service';

const EMAIL_INPUT = 'ghost@acme.test';

describe('login action — EMAIL_LOGIN_DISABLED when org disables email login', () => {
  it('email-shaped unknown identifier → EMAIL_LOGIN_DISABLED (400)', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      mockLoginSettings: { disableLoginWithEmail: true },
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: EMAIL_INPUT },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'EMAIL_LOGIN_DISABLED');
    });
  });
});
