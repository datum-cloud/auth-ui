// cypress/component/routes/device/complete-loader.cy.ts
//
// cy.task port of app/routes/device/__tests__/complete-loader.test.ts.
// The device/complete loader reads ?decision (enum authorize|deny) and returns it;
// it never calls the provider. Node-bound because the route imports server-only modules.
import { callService } from '../../../support/node/call-service';

describe('device/complete loader — decision validation', () => {
  it('missing ?decision → fails safe to deny', () => {
    callService({
      fn: 'deviceCompleteLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device/complete' },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.decision).to.equal('deny');
    });
  });
});
