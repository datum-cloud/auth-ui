// cypress/component/routes/login/device-thread.cy.ts
//
// cy.task port of app/routes/login/__tests__/device-thread.test.ts.
// Device-grant ceremony threading: /device/authorize sends the user to
// /login?requestId=device_<userCode>. Both identifier and password actions must
// accept and thread the device_ requestId (bug: old schemas allowed only /^oidc_/).
import { callService } from '../../../support/node/call-service';

const REQUEST_ID = 'device_WDJB-MJHT';
const ALICE = 'alice@acme.test';
const SESSION = { id: 's1', token: 't1', loginName: ALICE };

describe('device_ requestId threading through the login ceremony', () => {
  it('identifier action accepts a device_ requestId and threads it (not 400)', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: ALICE, requestId: REQUEST_ID },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.contain(`requestId=${REQUEST_ID}`);
    });
  });

  it('password action accepts a device_ requestId and threads it (not 400)', () => {
    // Seed alice's live session so verifyLoginPassword's provider.updateSession can find it.
    callService({
      fn: 'loginPasswordAction',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/login/password',
        sessions: [SESSION],
        form: { loginName: ALICE, password: 'hunter2', requestId: REQUEST_ID },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.contain(`requestId=${REQUEST_ID}`);
    });
  });
});
