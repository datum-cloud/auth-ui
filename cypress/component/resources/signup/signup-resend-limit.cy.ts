// cypress/component/resources/signup/signup-resend-limit.cy.ts
//
// CY-TASK: allowResend keys on hashActor(email), and the browser bundle stubs
// observability's hashActor to '' — which would collapse every address into ONE key and
// make the per-address test meaningless. The real hash only runs node-side.
//
// Each test is a single scenario carrying an ordered list of (email, nowMs) checks; the
// harness resets the module-level limiter state, replays the list through the real
// allowResend, and returns the boolean verdicts in order.
import type { Scenario, Verdict } from '../../../support/node/scenario';

function checkResend(checks: Array<{ email: string; nowMs: number }>): Cypress.Chainable<Verdict> {
  return cy.task<Verdict>('callService', {
    fn: 'allowResend',
    resendChecks: checks,
  } as Scenario);
}

const T0 = 1_000_000;
const WINDOW_MS = 5 * 60_000;

describe('signup resend limiter (D-RL)', () => {
  it('allows the first resend and blocks the second within 5 minutes', () => {
    checkResend([
      { email: 'a@b.test', nowMs: T0 },
      { email: 'a@b.test', nowMs: T0 + 60_000 },
      { email: 'a@b.test', nowMs: T0 + WINDOW_MS + 1 },
    ]).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      expect(v.outcome).to.deep.equal([true, false, true]);
    });
  });

  it('limits per address, not globally', () => {
    checkResend([
      { email: 'a@b.test', nowMs: T0 },
      { email: 'c@d.test', nowMs: T0 },
    ]).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      expect(v.outcome).to.deep.equal([true, true]);
    });
  });

  // REGRESSION (D-RL): the daily cap must count SENDS, not ATTEMPTS.
  //
  // RateLimiter.check() records a hit even when it denies, so an ordering that consults the
  // daily limiter before the burst window spends a daily slot on every burst-rejected request.
  // Six rapid submissions then send ONE mail and still exhaust the address's 24h budget —
  // letting an attacker keep squatting the address this resend exists to free. The spaced-window
  // test below cannot catch it: every one of its checks clears the burst window, so `daily` only
  // ever increments on real sends there.
  it('a rejected burst does not consume the daily budget', () => {
    const burstInWindow = Array.from({ length: 6 }, (_, i) => ({
      email: 'a@b.test',
      nowMs: T0 + i * 1000,
    }));
    // The real owner, later — one attempt per fresh window, well inside the same day.
    const ownerRetries = Array.from({ length: 4 }, (_, i) => ({
      email: 'a@b.test',
      nowMs: T0 + (i + 1) * (WINDOW_MS + 1),
    }));
    checkResend([...burstInWindow, ...ownerRetries]).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      const verdicts = v.outcome as boolean[];
      // One send from the burst; the other five are window-rejected and must cost nothing.
      expect(verdicts.slice(0, 6), 'burst: one send, five rejected').to.deep.equal([
        true,
        false,
        false,
        false,
        false,
        false,
      ]);
      // 4 of the 5 daily sends remain, so every owner retry still goes through.
      expect(verdicts.slice(6), 'owner keeps their remaining daily budget').to.deep.equal([
        true,
        true,
        true,
        true,
      ]);
    });
  });

  it('enforces the daily cap even across fresh 5-minute windows', () => {
    const checks = Array.from({ length: 12 }, (_, i) => ({
      email: 'a@b.test',
      nowMs: T0 + i * (WINDOW_MS + 1),
    }));
    checkResend(checks).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      const allowed = (v.outcome as boolean[]).filter(Boolean).length;
      // RESEND_DAILY_CAP — asserted as the literal the module exports; the harness cannot
      // import the constant into the browser side, so the spec pins the number.
      expect(allowed).to.equal(5);
    });
  });
});
