// cypress/component/routes/device/authorize-action.cy.ts
//
// cy.task port of app/routes/device/__tests__/authorize-action.test.ts.
//
// The action runs assertCsrf (HMAC round-trip) and gates authorize on a signed-in session.
// Node-bound: runs through buildHandlerRequest in the harness.
import { callService } from '../../../support/node/call-service';

describe('device/authorize action', () => {
  it('authorize without session → redirects to /login (session gate)', () => {
    // The service gates authorize on a signed-in session. With no sessions cookie,
    // it redirects to /login?requestId=... instead of calling authorizeDevice.
    callService({
      fn: 'deviceAuthorizeAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/device/authorize',
        form: { deviceAuthId: 'dev-1', requestId: 'device_WDJB-MJHT', decision: 'authorize' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.include('/login');
      expect(v.response?.location).to.include('requestId=');
    });
  });
});
