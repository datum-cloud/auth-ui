// cypress/component/routes/login/verify-email.cy.ts
//
// cy.task port of app/routes/login/verify/__tests__/email.test.ts.
// Route-level loader test for the OTP-email LINK fix (Bug A): arriving WITH ?code
// suppresses the duplicate challenge re-send (the fix prevents double-sending the OTP email).
import { callService } from '../../../support/node/call-service';

const LOGIN_NAME = 'alice@acme.test';
const BASE_URL = `http://localhost/id/login/verify/email?loginName=${encodeURIComponent(LOGIN_NAME)}`;
const SESSION = { id: 's1', token: 't1', loginName: LOGIN_NAME };
const LIVE_SESSION = { id: 's1', token: 't1', user: { id: 'u1', loginName: LOGIN_NAME } };

describe('login.verify.email loader — OTP-email LINK fix (Bug A) route gating', () => {
  it('suppresses the duplicate challenge re-send when arriving via the link (?code present)', () => {
    callService({
      fn: 'loginVerifyEmailLoader',
      provider: 'singleton',
      liveSessions: [LIVE_SESSION],
      env: { PUBLIC_ORIGIN: 'https://auth.datum.net' },
      recordCalls: ['updateSession'],
      request: {
        url: `${BASE_URL}&code=86230120`,
        sessions: [SESSION],
      },
    }).then((v) => {
      const calls = v.calls?.updateSession ?? [];
      expect(calls).to.have.length(0);
    });
  });
});
