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
  it('matching identity → no mismatch, intent echoed, clear cookie present', () => {
    callService({
      fn: 'reauthIntentCheck',
      reauthOp: 'checkMatch',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      const r = v.outcome as ReauthCheck;
      expect(r.intent).to.equal('alice@acme.test');
      expect(r.mismatch).to.equal(false);
      expect(r.clearCookie).to.include('reauth-intent=');
    });
  });

  it('different identity → mismatch true, clear cookie still present', () => {
    callService({
      fn: 'reauthIntentCheck',
      reauthOp: 'checkMismatch',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      const r = v.outcome as ReauthCheck;
      expect(r.intent).to.equal('alice@acme.test');
      expect(r.mismatch).to.equal(true);
      expect(r.clearCookie).to.include('reauth-intent=');
    });
  });
});
