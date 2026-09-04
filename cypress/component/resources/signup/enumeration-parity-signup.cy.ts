// cypress/component/resources/signup/enumeration-parity-signup.cy.ts
//
// G7 — signup response-parity, REVISED.
//
// Blanket three-way parity was narrowed by a product decision: an address with an ENROLLED account
// now returns 409 ALREADY_EXISTS instead of a generic "check your email" for mail that was never
// sent. THIS IS AN INTENTIONAL ENUMERATION DISCLOSURE — do not restore the old assertions without
// reopening that decision.
//
// Still pinned here:
//   1. FRESH vs SQUATTED parity — an address held by a credential-less account must stay
//      indistinguishable from a free one, or the real owner is permanently locked out.
//   2. ENROLLED discloses — asserted positively, so it stays a decision rather than a regression.
//   3. Invalid input is rejected identically regardless of account state.
import type { Scenario, Verdict } from '../../../support/node/scenario';

const TARGET = 'target@b.test';
const U = { id: 'u-1', loginName: TARGET, displayName: 'Target' };

const ENV = { AUTH_EMAIL_DELIVERY_ENABLED: 'true', EMAIL_VERIFICATION: 'true' };

// Account states, now split by what the response is ALLOWED to reveal.
// U_FACTORLESS holds the address with no auth method; U_ENROLLED has a passkey.
const PARITY_STATES = [
  { label: 'fresh address', seed: {} },
  { label: 'existing unverified + factorless (squatted)', seed: { users: [U] } },
] as const;

const ENROLLED_STATE = {
  label: 'existing account with a passkey',
  seed: { users: [U], authMethods: { 'u-1': ['passkey'] } },
} as const;

type RouteCase = {
  route: string;
  fn: Scenario['fn'];
  form: (loginName: string) => Record<string, string>;
};

// The routes that can actually REGISTER. Both must be live paths — a retired one returns an
// identical 400 for every account state and would make this gate pass vacuously, which is
// strictly worse than failing: it reads green while checking nothing.
//
// This list previously held '/signup/method' with intent 'email-link' and '/signup/password'.
// Both are now closed (the schema rejects the retired intents; the password route fails shut),
// so each was reduced to comparing three identical 400s. Repointed at what actually sends mail:
// /signup, which registers inline, and /signup/method with the one intent it still accepts.
const ROUTES: RouteCase[] = [
  {
    route: '/signup',
    fn: 'signupIndexAction',
    form: (loginName) => ({ email: loginName }),
  },
  {
    route: '/signup/method',
    fn: 'signupMethodAction',
    form: (loginName) => ({ intent: 'passkey', loginName, firstName: 'A', lastName: 'B' }),
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

describe('G7 — signup response parity (revised: enrolled accounts disclose)', () => {
  for (const rc of ROUTES) {
    // THE HALF THAT MUST HOLD. A squatted address (unverified, no auth method) must be
    // indistinguishable from a free one — disclosing there strands the real owner on an account
    // nobody can sign in to.
    it(`${rc.route}: a squatted address is indistinguishable from a fresh one`, () => {
      const results: Array<{ label: string; obs: ReturnType<typeof observable> }> = [];
      for (const c of PARITY_STATES) {
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

    // THE DELIBERATE DISCLOSURE, asserted positively so it stays a decision rather than drifting.
    it(`${rc.route}: an enrolled account is told the address is already registered`, () => {
      submit(rc, TARGET, ENROLLED_STATE.seed).then((v) => {
        expect(v.ok, v.error ?? '').to.be.true;
        const obs = observable(v);
        expect(obs.dataStatus, 'discloses with 409').to.equal(409);
        expect(obs.dataBody).to.have.property('error', 'ALREADY_EXISTS');
        // Never a session or a "sent" terminal: this address was not mailed anything.
        expect(obs.setCookies ?? [], 'no session minted').to.deep.equal([]);
        expect(JSON.stringify(obs.dataBody ?? {}), 'must not claim mail was sent').to.not.contain(
          'sent'
        );
      });
    });

    // And it must actually DIFFER from the fresh response — otherwise the disclosure silently
    // regressed to the old generic answer and the test above would still pass on a 409 that
    // fresh addresses also return.
    it(`${rc.route}: the enrolled response differs from the fresh one`, () => {
      const seen: Array<{ label: string; obs: ReturnType<typeof observable> }> = [];
      for (const c of [PARITY_STATES[0], ENROLLED_STATE]) {
        submit(rc, TARGET, c.seed).then((v) => {
          seen.push({ label: c.label, obs: observable(v) });
        });
      }
      cy.then(() => {
        expect(seen[1].obs, 'enrolled must not equal fresh').to.not.deep.equal(seen[0].obs);
      });
    });

    it(`${rc.route}: invalid input is rejected identically regardless of account existence`, () => {
      const results: Array<{ label: string; obs: ReturnType<typeof observable> }> = [];
      for (const c of [...PARITY_STATES, ENROLLED_STATE]) {
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
