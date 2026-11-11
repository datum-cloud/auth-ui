// cypress/component/routes/device/authorize-decision.cy.ts
//
// /device/authorize action, decision paths. authorize-action.cy.ts pins the sessionless
// authorize gate; this file covers what happens once the gate is passed or does not apply:
// a signed-in authorize approves the device, a deny rejects it without a session, and a
// malformed or unknown submission never approves anything.
// Node-bound: the action runs assertCsrf and reads the signed `sessions` cookie.
import { callService } from '../../../support/node/call-service';

const URL = 'http://localhost/id/device/authorize';
const SESSION = { id: 'sess-dev', token: 'tok-dev', loginName: 'mia@acme.test' };

describe('/device/authorize action — decisions', () => {
  it('authorize with a signed-in session approves the device and lands on /device/complete', () => {
    callService({
      fn: 'deviceAuthorizeAction',
      provider: 'singleton',
      liveSessions: [{ id: SESSION.id, token: SESSION.token }],
      inspect: { isDeviceAuthorized: ['dev-authorize'] },
      request: {
        url: URL,
        sessions: [SESSION],
        form: {
          deviceAuthId: 'dev-authorize',
          requestId: 'device_AUTH-CODE',
          decision: 'authorize',
        },
        csrf: true,
      },
    }).then((v) => {
      expect(v.ok, v.error).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.include('/device/complete');
      expect(v.inspect?.isDeviceAuthorized).to.deep.equal({ 'dev-authorize': true });
    });
  });

  it('deny works without a session and leaves the device unapproved', () => {
    callService({
      fn: 'deviceAuthorizeAction',
      provider: 'singleton',
      inspect: { isDeviceAuthorized: ['dev-deny'] },
      request: {
        url: URL,
        form: { deviceAuthId: 'dev-deny', requestId: 'device_DENY-CODE', decision: 'deny' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.ok, v.error).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.include('/device/complete');
      expect(v.response?.location).to.not.include('/login');
      expect(v.inspect?.isDeviceAuthorized).to.deep.equal({ 'dev-deny': false });
    });
  });

  it('an unrecognised decision value is rejected with 400', () => {
    callService({
      fn: 'deviceAuthorizeAction',
      provider: 'singleton',
      liveSessions: [{ id: SESSION.id, token: SESSION.token }],
      inspect: { isDeviceAuthorized: ['dev-authorize'] },
      request: {
        url: URL,
        sessions: [SESSION],
        form: { deviceAuthId: 'dev-authorize', requestId: 'device_AUTH-CODE', decision: 'maybe' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus ?? v.response?.status).to.equal(400);
      expect(v.inspect?.isDeviceAuthorized).to.deep.equal({ 'dev-authorize': false });
    });
  });

  it('a device request the provider no longer knows surfaces a 502, not a crash', () => {
    callService({
      fn: 'deviceAuthorizeAction',
      provider: 'singleton',
      liveSessions: [{ id: SESSION.id, token: SESSION.token }],
      request: {
        url: URL,
        sessions: [SESSION],
        form: { deviceAuthId: 'dev-gone', requestId: 'device_GONE-CODE', decision: 'authorize' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.ok, v.error).to.equal(true);
      expect(v.response?.dataStatus ?? v.response?.status).to.equal(502);
    });
  });
});
