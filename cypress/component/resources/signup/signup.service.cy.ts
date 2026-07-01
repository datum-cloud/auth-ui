// cypress/component/resources/signup/signup.service.cy.ts
//
// CY-TASK: runs node-side via cy.task('runScenario') because signup.service.ts imports
// observability.ts (logAuthEvent → console.log), which is stubbed to a no-op in the Vite
// browser bundle. Real audit must flow through the Bun harness so audit-shape assertions
// are meaningful.
//
// Classification: CY-TASK
// Source: app/resources/signup/__tests__/signup.service.test.ts
import type { Scenario, Verdict } from '../../../support/node/scenario';

const BASE_URL = 'https://auth.datum.test';
const ORIGIN = 'https://auth.datum.test';

/** Drive the scenario through the real Bun node harness and return the raw verdict.
 *  Uses the low-level cy.task('callService') rather than the callService() wrapper so that
 *  tests which examine error states (verdict.ok === false) can do so without the wrapper
 *  auto-failing the assertion. Each test checks verdict.ok / verdict.error explicitly. */
function run(s: Scenario): Cypress.Chainable<Verdict> {
  return cy.task<Verdict>('callService', s);
}

// ─────────────────────────────────────────────────────────────────────────────
// registerEmailLinkSignup — enumeration safety
// ─────────────────────────────────────────────────────────────────────────────

describe('registerEmailLinkSignup', () => {
  it('returns the identical sent result whether the email is new or already registered (no enumeration)', () => {
    run({
      fn: 'registerEmailLinkSignup',
      request: { url: `${BASE_URL}/signup` },
      provider: 'fresh',
      seed: { users: [] },
      signupInput: {
        email: 'new@x.com',
        firstName: 'New',
        lastName: 'User',
        origin: 'https://auth.test',
      },
    }).then((freshVerdict) => {
      expect(freshVerdict.ok, freshVerdict.error ?? '').to.be.true;
      const freshOutcome = freshVerdict.outcome as Record<string, unknown>;
      expect(freshOutcome.kind).to.eq('sent');

      run({
        fn: 'registerEmailLinkSignup',
        request: { url: `${BASE_URL}/signup` },
        provider: 'fresh',
        seed: { users: [{ id: 'u1', loginName: 'dupe@x.com', displayName: 'Dupe' }] },
        signupInput: {
          email: 'dupe@x.com',
          firstName: 'Dupe',
          lastName: 'Dupe',
          origin: 'https://auth.test',
        },
      }).then((dupeVerdict) => {
        expect(dupeVerdict.ok, dupeVerdict.error ?? '').to.be.true;
        const dupeOutcome = dupeVerdict.outcome as Record<string, unknown>;
        // Enumeration-safe: identical shape as a fresh signup.
        expect(dupeOutcome.kind).to.eq('sent');
        expect(dupeOutcome.email).to.eq('dupe@x.com');
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit-event divergence guard
//
// registerPasskeyFirst and registerWithPassword share most of their flow BUT emit
// DIFFERENT audit on the no-verification success path — the merge must NOT collapse:
//   passkey-first  no-verify success → 'signup.requested' { actor, organization }
//   with-password  no-verify success → 'signup.created'   { userId, actor }
// ─────────────────────────────────────────────────────────────────────────────

describe('registerWithPassword / registerPasskeyFirst — session metadata + audit-event shape (divergence guard)', () => {
  const base = {
    email: 'dave@acme.test',
    firstName: 'Dave',
    lastName: 'Acme',
    origin: ORIGIN,
  };

  it('forwards deviceTrackingToken as MaxMind session metadata; passkey-first no-verify success emits signup.requested while password no-verify success emits signup.created', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        email: 'bob@acme.test',
        firstName: 'Bob',
        lastName: 'Acme',
        password: 'hunter2hunter2',
        requireVerification: false,
        origin: ORIGIN,
        deviceTrackingToken: 'tok',
      },
      inspect: { lastCreateSessionOpts: true },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const opts = (verdict.inspect as Record<string, unknown>)?.lastCreateSessionOpts as Record<
        string,
        unknown
      > | null;
      expect(opts).to.not.be.null;
      expect((opts?.metadata as Record<string, unknown>)?.['maxmind/tracking-token']).to.eq('tok');
      expect(opts?.userId).to.be.a('string').and.not.be.empty;
    });

    run({
      fn: 'registerPasskeyFirst',
      request: { url: `${BASE_URL}/signup` },
      provider: 'singleton',
      signupInput: { ...base, organization: 'org-z', requireVerification: false },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.eq('redirect');

      // The passkey path uses 'signup.requested', NOT 'signup.created'.
      const created = verdict.audit.find((e) => e.event === 'signup.created');
      expect(created, 'should NOT emit signup.created').to.be.undefined;

      const requested = verdict.audit.find((e) => e.event === 'signup.requested');
      expect(requested?.outcome).to.eq('success');
      expect(requested?.organization).to.eq('org-z');
      expect(requested).to.have.property('actor');
      expect(requested).to.not.have.property('userId');
    });

    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        ...base,
        password: 'hunter2hunter2',
        organization: 'org-z',
        requireVerification: false,
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.eq('redirect');

      // The password path uses 'signup.created', carrying userId, no organization.
      const created = verdict.audit.find((e) => e.event === 'signup.created');
      expect(created?.outcome).to.eq('success');
      expect(created).to.have.property('userId');
      expect(created).to.have.property('actor');
      expect(created).to.not.have.property('organization');
    });
  });
});
