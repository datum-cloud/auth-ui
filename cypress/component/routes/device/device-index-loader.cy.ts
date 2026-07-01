// cypress/component/routes/device/device-index-loader.cy.ts
//
// cy.task port of app/routes/device/__tests__/device-index-loader.test.ts.
// Covers the device/index loader (CSRF token + user_code param threading).
// The action's CSRF-failure path is infrastructure behavior (assertCsrf throws) — dropped per
// pruning policy; the CSRF guard itself is covered by the csrfCheck task specs.
import { callService } from '../../../support/node/call-service';

describe('device/index loader', () => {
  it('returns csrfToken and userCode from the user_code query param', () => {
    callService({
      fn: 'deviceIndexLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device?user_code=WDJB-MJHT' },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(typeof body?.csrfToken).to.equal('string');
      expect((body?.csrfToken as string).length).to.be.greaterThan(0);
      expect(body?.userCode).to.equal('WDJB-MJHT');
    });
  });
});
