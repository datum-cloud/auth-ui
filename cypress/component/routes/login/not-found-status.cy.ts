// cypress/component/routes/login/not-found-status.cy.ts
//
// cy.task port of app/routes/login/__tests__/not-found-status.test.ts.
// F1: unknown identifier → USER_NOT_FOUND as 200 (not 404) — no console-erroring 404.
import { callService } from '../../../support/node/call-service';

const UNKNOWN = 'nobody-here@acme.test';

describe('login action — USER_NOT_FOUND is a 200 inline error, not a 404 (F1)', () => {
  it('unknown identifier → USER_NOT_FOUND with HTTP 200 (no console-erroring 404)', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: UNKNOWN },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataBody).to.have.property('error', 'USER_NOT_FOUND');
      // dataStatus absent means 200 default
      const status = v.response?.dataStatus ?? 200;
      expect(status).to.equal(200);
    });
  });
});
