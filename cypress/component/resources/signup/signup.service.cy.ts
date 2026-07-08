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
// Default-org resolution — register paths (bare flow, no organization= in URL)
//
// On a bare signup (no ?organization= in the URL) raw `organization` is undefined.
// Each register service must resolve the default org via resolveOrg and pass it as
// orgId to provider.register() (and createSession). The fake does NOT throw on
// undefined orgId, so we assert the ARG to get a genuine RED before the fix.
// RED: orgId === undefined. GREEN: orgId === 'org-default-fake'.
// ─────────────────────────────────────────────────────────────────────────────

describe('registerAndLinkIdp — default-org resolution on bare flow (no organization)', () => {
  it('calls register with the resolved default org (not undefined) when organization is omitted', () => {
    run({
      fn: 'registerAndLinkIdp',
      request: { url: `${BASE_URL}/signup` },
      provider: 'singleton',
      // No organization in signupInput → bare flow
      signupInput: {
        email: 'idp-bare@test.com',
        firstName: 'Idp',
        lastName: 'Bare',
        idpIntentId: 'intent-bare',
        idpIntentToken: 'tok-bare',
        idpId: 'idp-g',
        idpUserId: 'g-bare',
        idpUserName: 'idp-bare@test.com',
      },
      recordCalls: ['register'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const registerCalls = (verdict.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls.length, 'register was called').to.be.greaterThan(0);
      const registerInput = registerCalls[0][0];
      expect(registerInput.orgId, 'orgId must be the resolved default org, not undefined').to.equal(
        'org-default-fake'
      );
    });
  });
});

describe('registerPasskeyFirst — default-org resolution on bare flow (no organization)', () => {
  it('calls register with the resolved default org (not undefined) when organization is omitted', () => {
    run({
      fn: 'registerPasskeyFirst',
      request: { url: `${BASE_URL}/signup` },
      provider: 'singleton',
      signupInput: {
        email: 'passkey-bare@test.com',
        firstName: 'Passkey',
        lastName: 'Bare',
        requireVerification: false,
        origin: ORIGIN,
        // No organization → bare flow
      },
      recordCalls: ['register'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const registerCalls = (verdict.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls.length, 'register was called').to.be.greaterThan(0);
      const registerInput = registerCalls[0][0];
      expect(registerInput.orgId, 'orgId must be the resolved default org, not undefined').to.equal(
        'org-default-fake'
      );
    });
  });
});

describe('registerWithPassword — default-org resolution on bare flow (no organization)', () => {
  it('calls register with the resolved default org (not undefined) when organization is omitted', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        email: 'pw-bare@test.com',
        firstName: 'Pw',
        lastName: 'Bare',
        password: 'hunter2hunter2',
        requireVerification: false,
        origin: ORIGIN,
        // No organization → bare flow
      },
      recordCalls: ['register'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const registerCalls = (verdict.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls.length, 'register was called').to.be.greaterThan(0);
      const registerInput = registerCalls[0][0];
      expect(registerInput.orgId, 'orgId must be the resolved default org, not undefined').to.equal(
        'org-default-fake'
      );
    });
  });
});

describe('registerEmailLinkSignup — default-org resolution on bare flow (no organization)', () => {
  it('calls register with the resolved default org (not undefined) when organization is omitted', () => {
    run({
      fn: 'registerEmailLinkSignup',
      request: { url: `${BASE_URL}/signup` },
      provider: 'singleton',
      signupInput: {
        email: 'emaillink-bare@test.com',
        firstName: 'Email',
        lastName: 'Bare',
        origin: ORIGIN,
        // No organization → bare flow
      },
      recordCalls: ['register'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const registerCalls = (verdict.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls.length, 'register was called').to.be.greaterThan(0);
      const registerInput = registerCalls[0][0];
      expect(registerInput.orgId, 'orgId must be the resolved default org, not undefined').to.equal(
        'org-default-fake'
      );
    });
  });
});

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
// Task 1: registerWithPassword — verification skip (EMAIL_VERIFICATION=false)
//
// When requireVerification=false, provider.register() must be called with
// emailVerified:true and NO verifyUrlTemplate (Zitadel marks the email
// verified in-place, sends nothing). When requireVerification=true, the
// existing sent-with-session path is preserved (verifyUrlTemplate present).
// ─────────────────────────────────────────────────────────────────────────────

describe('registerWithPassword — verification skip (requireVerification=false)', () => {
  it('calls register with emailVerified:true and NO verifyUrlTemplate when requireVerification=false', () => {
    // RED: before the fix, register was always called with verifyUrlTemplate and no emailVerified.
    // GREEN: when requireVerification=false, emailVerified:true + no verifyUrlTemplate.
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        email: 'noverify@test.com',
        firstName: 'No',
        lastName: 'Verify',
        password: 'hunter2hunter2',
        requireVerification: false,
        origin: ORIGIN,
        organization: 'org-z',
      },
      recordCalls: ['register'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const registerCalls = (verdict.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls.length, 'register was called once').to.equal(1);
      const arg = registerCalls[0][0];
      // Must be pre-verified — Zitadel marks email verified, sends nothing.
      expect(arg.emailVerified, 'emailVerified must be true').to.equal(true);
      // Must NOT include verifyUrlTemplate — that would trigger Zitadel's sendCode path.
      expect(arg.verifyUrlTemplate, 'verifyUrlTemplate must be absent').to.be.undefined;
    });
  });

  it('result is a redirect (not sent-with-session) when requireVerification=false', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        email: 'noverify2@test.com',
        firstName: 'No',
        lastName: 'Verify',
        password: 'hunter2hunter2',
        requireVerification: false,
        origin: ORIGIN,
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      // No-verification path must redirect, never stall on "check your email".
      expect(r.kind).to.equal('redirect');
    });
  });

  it('calls register with verifyUrlTemplate and NO emailVerified when requireVerification=true (existing path unchanged)', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        email: 'withverify@test.com',
        firstName: 'With',
        lastName: 'Verify',
        password: 'hunter2hunter2',
        requireVerification: true,
        origin: ORIGIN,
        organization: 'org-z',
      },
      recordCalls: ['register'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const registerCalls = (verdict.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls.length, 'register was called once').to.equal(1);
      const arg = registerCalls[0][0];
      // Verification ON: verifyUrlTemplate present, emailVerified absent/falsy.
      expect(arg.verifyUrlTemplate, 'verifyUrlTemplate must be present').to.be.a('string').and.not
        .be.empty;
      expect(arg.emailVerified, 'emailVerified must be absent').to.be.undefined;
    });
  });

  it('result is sent-with-session when requireVerification=true (existing path unchanged)', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        email: 'withverify2@test.com',
        firstName: 'With',
        lastName: 'Verify',
        password: 'hunter2hunter2',
        requireVerification: true,
        origin: ORIGIN,
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.equal('sent-with-session');
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

// ─────────────────────────────────────────────────────────────────────────────
// Read-after-write retry (Zitadel eventual consistency): runEnumerationSafeRegister
// previously only caught ALREADY_EXISTS from register()/persistSession() — a transient
// NOT_FOUND (the register-side mirror of the authorize-side healIfSessionDead race, e.g. a
// replica lag on a follow-up lookup) rethrew uncaught, surfacing to the route as a raw 400
// instead of completing registration. retryOnceIfNotFound retries the failed step exactly once
// before letting it propagate — this must NOT weaken the ALREADY_EXISTS enumeration-safe path
// (covered above; untouched by this change) and must NOT loop on a genuine not-found.
// ─────────────────────────────────────────────────────────────────────────────

describe('registerWithPassword — read-after-write retry on a transient NOT_FOUND', () => {
  it('register() throws NOT_FOUND once then succeeds on retry → registration completes normally (RED before the fix: verdict.ok is false, the error propagates uncaught)', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      // Harness hook (fake-provider.ts + harness.ts): fails the FIRST register() call only,
      // then delegates to the real fake register() — simulating "the write raced a lagging
      // read replica once, then resolved".
      registerErrorOnce: 'NOT_FOUND',
      signupInput: {
        email: 'retry-once@test.com',
        firstName: 'Retry',
        lastName: 'Once',
        password: 'hunter2hunter2',
        requireVerification: true,
        origin: ORIGIN,
      },
    }).then((verdict) => {
      // Before the fix this assertion is the RED signal: the uncaught NOT_FOUND propagates out
      // of registerWithPassword, the harness's try/catch sets ok:false, and verdict.error holds
      // the raw provider message — never reaching the sent-with-session outcome below.
      expect(verdict.ok, verdict.error ?? 'registration should not have thrown').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.equal('sent-with-session');
      expect(r.email).to.equal('retry-once@test.com');
    });
  });
});
