// cypress/component/modules/auth/session/reauth-intent.cy.ts
//
// Node-bound (cy.task) port of app/modules/auth/session/__tests__/reauth-intent.test.ts.
//
// The reauth-intent cookie + the SHARED re-auth identity guard (checkReauthIntent) is the single
// source of the match/mismatch decision for EVERY login factor (password, IdP callback,
// passkey/security-key) — a SECURITY guard. reauth-intent.ts is signed with SESSION_SECRET and is
// stubbed out of the Vite browser bundle, and the guard reads a Cookie header off a Request (which
// the Fetch spec forbids in the browser), so the REAL guard runs in Bun via cy.task.
import { callService } from '../../../../support/node/call-service';

interface ReauthCheck {
  intent: string | null;
  mismatch: boolean;
  clearCookie?: string;
}

describe('checkReauthIntent (shared identity guard)', () => {
  // The match/mismatch pair chains in one test, matching the established cy.task pattern. Each
  // callService spawns a fresh Bun process, so the two decisions stay fully independent. The
  // MISMATCH case runs first: it is the one that actually denies a re-auth against the wrong
  // identity, so it must never be masked by a failure in the permissive case.
  it('echoes the intent and clears the cookie, flagging mismatch only on a different identity', () => {
    callService({
      fn: 'reauthIntentCheck',
      reauthOp: 'checkMismatch',
      request: { url: 'http://localhost/id' },
    })
      .then((v) => {
        const r = v.outcome as ReauthCheck;
        expect(r.intent, 'mismatch: intent echoed').to.equal('alice@acme.test');
        expect(r.mismatch, 'mismatch: flagged').to.equal(true);
        expect(r.clearCookie, 'mismatch: clear cookie present').to.include('reauth-intent=');
        return callService({
          fn: 'reauthIntentCheck',
          reauthOp: 'checkMatch',
          request: { url: 'http://localhost/id' },
        });
      })
      .then((v) => {
        const r = v.outcome as ReauthCheck;
        expect(r.intent, 'match: intent echoed').to.equal('alice@acme.test');
        expect(r.mismatch, 'match: not flagged').to.equal(false);
        expect(r.clearCookie, 'match: clear cookie present').to.include('reauth-intent=');
      });
  });
});
