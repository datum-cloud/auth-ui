// cypress/component/routes/logout/passkey-hint-clear.cy.ts
//
// Owner-scoped hint clearing: /logout clears the passkey-hint ONLY when it names the
// signing-out (most-recent) account; the OIDC sign-out-of-all path always clears it.
import { callService } from '../../../support/node/call-service';

const BOB = 'bob@acme.test';
const ALICE = 'alice@acme.test';
const BOB_SESSION = { id: 's1', token: 't1', loginName: BOB };

describe('/logout — passkey-hint clearing', () => {
  it('clears the hint when it names the signing-out user (case-insensitive)', () => {
    callService({
      fn: 'logoutAction',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u9', loginName: BOB } }],
      request: {
        url: 'http://localhost/id/logout',
        sessions: [BOB_SESSION],
        csrf: true,
        passkeyHint: 'Bob@ACME.test',
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.passkeyHint).to.equal(''); // '' = cleared (Max-Age=0)
    });
  });

  it("leaves the hint alone when a DIFFERENT user's hint is stored (Alice signs out, hint = Bob)", () => {
    callService({
      fn: 'logoutAction',
      provider: 'singleton',
      liveSessions: [{ id: 's2', token: 't2', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/logout',
        sessions: [{ id: 's2', token: 't2', loginName: ALICE }],
        csrf: true,
        passkeyHint: BOB,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(
        (v.response?.setCookies ?? []).some((c: string) => c.startsWith('passkey-hint='))
      ).to.equal(false);
    });
  });

  it('OIDC sign-out-of-all (logout_token) always clears the hint', () => {
    callService({
      fn: 'logoutLoader',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u9', loginName: BOB } }],
      request: {
        url: 'http://localhost/id/logout?logout_token=tok',
        sessions: [BOB_SESSION],
        passkeyHint: ALICE, // even a hint for someone ELSE is cleared on sign-out-of-all
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.passkeyHint).to.equal('');
    });
  });
});
