// cypress/component/resources/signup/enumeration-parity-signup.cy.ts
//
// G7 — RELEASE-BLOCKING enumeration parity for signup, the signup-side sibling of
// routes/login/enumeration-parity.cy.ts (same harness, same comparison discipline).
//
// The invariant has TWO deliberately separate parts — do not "fix" the split by collapsing it:
//
//   1. ACCOUNT-STATE parity: the three states a syntactically valid address can be in
//      (fresh / existing verified / existing unverified) must produce byte-identical
//      responses — status, body, and Set-Cookie. This is the release-blocking half: any
//      divergence is an account-existence oracle.
//   2. INVALID-INPUT independence: a malformed address is NOT an account state — a 400 on
//      'not-an-email' reveals nothing about who has an account, so it is not required to
//      match the 200 the valid rows return. What IS required: the rejection must be
//      identical for EVERY seed, i.e. rejection depends only on the input, never on
//      whether the address exists.
//
// Runs under the Phase B target configuration (delivery on, verification on) — the
// configuration the hard gate actually ships under. Reaching the existing-account rows at
// all is only possible because the fake provider now throws ALREADY_EXISTS (D-FAKE).
import type { Scenario, Verdict } from '../../../support/node/scenario';

const TARGET = 'target@b.test';
const U = { id: 'u-1', loginName: TARGET, displayName: 'Target' };

const ENV = { AUTH_EMAIL_DELIVERY_ENABLED: 'true', EMAIL_VERIFICATION: 'true' };

// The three account states, all submitting the SAME address so responses compare directly.
const ACCOUNT_STATES = [
  { label: 'fresh address', seed: {} },
  { label: 'existing verified', seed: { users: [U], authMethods: { 'u-1': ['passkey'] } } },
  { label: 'existing unverified', seed: { users: [U] } },
] as const;

type RouteCase = {
  route: string;
  fn: Scenario['fn'];
  form: (loginName: string) => Record<string, string>;
};

const ROUTES: RouteCase[] = [
  {
    route: '/signup/method',
    fn: 'signupMethodAction',
    form: (loginName) => ({ intent: 'email-link', loginName, firstName: 'A', lastName: 'B' }),
  },
  {
    route: '/signup/password',
    fn: 'signupPasswordAction',
    form: (loginName) => ({
      loginName,
      firstName: 'A',
      lastName: 'B',
      password: 'sup3rsecretpw',
      confirm: 'sup3rsecretpw',
    }),
  },
];

/** The comparable shape of a response — every channel an unauthenticated observer sees. */
function observable(v: Verdict) {
  return {
    isResponse: v.response?.isResponse ?? null,
    status: v.response?.status ?? null,
    location: v.response?.location ?? null,
    dataStatus: v.response?.dataStatus ?? null,
    dataBody: v.response?.dataBody ?? null,
    setCookies: v.response?.setCookies ?? [],
  };
}

function submit(rc: RouteCase, loginName: string, seed: Record<string, unknown>) {
  return cy.task<Verdict>('callService', {
    fn: rc.fn,
    seed,
    env: ENV,
    request: {
      url: `http://localhost/id${rc.route}`,
      form: rc.form(loginName),
      csrf: true,
    },
  } as unknown as Scenario);
}

describe('G7 — signup enumeration parity (release-blocking)', () => {
  for (const rc of ROUTES) {
    it(`${rc.route}: all three account states are byte-for-byte indistinguishable`, () => {
      const results: Array<{ label: string; obs: ReturnType<typeof observable> }> = [];
      for (const c of ACCOUNT_STATES) {
        submit(rc, TARGET, c.seed).then((v) => {
          expect(v.ok, `${c.label}: ${v.error ?? ''}`).to.be.true;
          results.push({ label: c.label, obs: observable(v) });
        });
      }
      cy.then(() => {
        const [first, ...rest] = results;
        for (const r of rest) {
          expect(r.obs, `${r.label} must equal ${first.label}`).to.deep.equal(first.obs);
        }
      });
    });

    it(`${rc.route}: invalid input is rejected identically regardless of account existence`, () => {
      const results: Array<{ label: string; obs: ReturnType<typeof observable> }> = [];
      for (const c of ACCOUNT_STATES) {
        submit(rc, 'not-an-email', c.seed).then((v) => {
          expect(v.ok, `${c.label}: ${v.error ?? ''}`).to.be.true;
          results.push({ label: c.label, obs: observable(v) });
        });
      }
      cy.then(() => {
        const [first, ...rest] = results;
        for (const r of rest) {
          expect(r.obs, `invalid input under '${r.label}' seed`).to.deep.equal(first.obs);
        }
      });
    });
  }
});
