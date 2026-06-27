// cypress/component/routes/device/complete-loader.cy.ts
//
// cy.task port of app/routes/device/__tests__/complete-loader.test.ts.
// The device/complete loader reads ?decision (enum authorize|deny) and returns it;
// it never calls the provider. Node-bound because the route imports server-only modules.
import { callService } from '../../../support/node/call-service';

describe('device/complete loader — decision validation', () => {
  it('?decision=authorize → returns decision: authorize', () => {
    callService({
      fn: 'deviceCompleteLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device/complete?decision=authorize' },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.decision).to.equal('authorize');
    });
  });

  it('?decision=deny → returns decision: deny', () => {
    callService({
      fn: 'deviceCompleteLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device/complete?decision=deny' },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.decision).to.equal('deny');
    });
  });

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

  it('tampered ?decision → fails safe to deny', () => {
    callService({
      fn: 'deviceCompleteLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device/complete?decision=garbage' },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.decision).to.equal('deny');
    });
  });
});
