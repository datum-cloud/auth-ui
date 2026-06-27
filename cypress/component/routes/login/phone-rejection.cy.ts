// cypress/component/routes/login/phone-rejection.cy.ts
//
// cy.task port of app/routes/login/__tests__/phone-rejection.test.ts.
// Task 4 route-level guard: PHONE_LOGIN_DISABLED when org disables phone login.
import { callService } from '../../../support/node/call-service';

const PHONE_INPUT = '+15550000000';

describe('login action — strict phone rejection per disableLoginWithPhone policy', () => {
  it('rejects phone-format loginName with PHONE_LOGIN_DISABLED when org disables phone login', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      mockLoginSettings: { disableLoginWithPhone: true },
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: PHONE_INPUT },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'PHONE_LOGIN_DISABLED');
    });
  });

  it('does NOT phone-reject when phone login is enabled (default-off → today behavior)', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      // No mockLoginSettings — defaults: disableLoginWithPhone false
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: PHONE_INPUT },
        csrf: true,
      },
    }).then((v) => {
      // Phone check bypassed → USER_NOT_FOUND (200 inline) not PHONE_LOGIN_DISABLED
      expect(v.response?.dataBody?.error).not.to.equal('PHONE_LOGIN_DISABLED');
    });
  });
});
