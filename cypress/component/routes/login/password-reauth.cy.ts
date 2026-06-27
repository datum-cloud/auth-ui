// cypress/component/routes/login/password-reauth.cy.ts
//
// cy.task port of app/routes/login/__tests__/password-reauth.test.ts.
// H-4: the password route's re-auth identity guard exercised at the HTTP boundary.
// Uses the real singleton (alice@acme.test/hunter2) — no vi.mock needed.
// The guard (checkReauthIntent) runs AFTER verifyLoginPassword succeeds.
import { callService } from '../../../support/node/call-service';

// alice = u1, hunter2 — seeded in the singleton with password 'hunter2'
const ALICE = 'alice@acme.test';
const SESSION = { id: 's1', token: 't1', loginName: ALICE };

describe('login/password action — re-auth identity guard (H-4)', () => {
  it('matching identity → completes to the resolved target and clears the intent', () => {
    callService({
      fn: 'loginPasswordAction',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/login/password',
        sessions: [SESSION],
        form: { loginName: ALICE, password: 'hunter2' },
        csrf: true,
        reauthIntent: ALICE,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      // Cleared reauth-intent cookie is emitted
      expect(v.response?.setCookies?.some((c: string) => c.startsWith('reauth-intent='))).to.equal(
        true
      );
    });
  });

  it('matches case-insensitively (no false mismatch on casing)', () => {
    callService({
      fn: 'loginPasswordAction',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/login/password',
        sessions: [SESSION],
        form: { loginName: ALICE, password: 'hunter2' },
        csrf: true,
        reauthIntent: 'Alice@ACME.test',
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      // Matching case-insensitively → no mismatch bounce
      const loc = v.response?.location ?? '';
      expect(loc).not.to.contain('/accounts');
    });
  });

  it('different identity → bounces to /accounts?reauthMismatch=1 (carrying requestId), clears intent', () => {
    // form loginName = alice, reauthIntent = totp-user → mismatch
    callService({
      fn: 'loginPasswordAction',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/login/password',
        sessions: [SESSION],
        form: { loginName: ALICE, password: 'hunter2', requestId: 'oidc_x' },
        csrf: true,
        reauthIntent: 'totp-user@acme.test',
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.contain('/accounts');
      expect(loc).to.contain('reauthMismatch=1');
      expect(loc).to.contain('requestId=oidc_x');
      expect(v.response?.setCookies?.some((c: string) => c.startsWith('reauth-intent='))).to.equal(
        true
      );
    });
  });

  it('no re-auth intent → completes normally (no mismatch bounce)', () => {
    callService({
      fn: 'loginPasswordAction',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/login/password',
        sessions: [SESSION],
        form: { loginName: ALICE, password: 'hunter2' },
        csrf: true,
        // No reauthIntent
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).not.to.contain('/accounts');
    });
  });
});
