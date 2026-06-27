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
// registerWithPassword — MaxMind token → session metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('registerWithPassword — MaxMind token → session metadata', () => {
  const baseInput = {
    email: 'bob@acme.test',
    firstName: 'Bob',
    lastName: 'Acme',
    password: 'hunter2hunter2',
    requireVerification: false,
    origin: ORIGIN,
  };

  it('forwards deviceTrackingToken as metadata["maxmind/tracking-token"]', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: { ...baseInput, deviceTrackingToken: 'tok' },
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
  });

  it('sets no metadata when deviceTrackingToken is absent', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: baseInput,
      inspect: { lastCreateSessionOpts: true },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const opts = (verdict.inspect as Record<string, unknown>)?.lastCreateSessionOpts as Record<
        string,
        unknown
      > | null;
      expect(opts?.metadata).to.be.undefined;
      expect(opts?.userId).to.be.a('string').and.not.be.empty;
    });
  });

  it('forwards userAgent to createSession', () => {
    const ua = {
      fingerprintId: 'fp-abc',
      ip: '1.2.3.4',
      description: 'Chrome, , , , Blink, , macOS, , ',
      header: { 'user-agent': { values: ['Mozilla/5.0'] } },
    };
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: { ...baseInput, userAgent: ua },
      inspect: { lastCreateSessionOpts: true },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const opts = (verdict.inspect as Record<string, unknown>)?.lastCreateSessionOpts as Record<
        string,
        unknown
      > | null;
      expect(opts?.userAgent).to.deep.eq(ua);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerEmailLinkSignup — enumeration safety
// ─────────────────────────────────────────────────────────────────────────────

describe('registerEmailLinkSignup', () => {
  it('registers passwordless and returns sent for a new email', () => {
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
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.eq('sent');
      expect(r.email).to.eq('new@x.com');
    });
  });

  it('returns the identical sent result for an existing email (no enumeration)', () => {
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
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      // Enumeration-safe: identical result as a fresh signup
      expect(r.kind).to.eq('sent');
      expect(r.email).to.eq('dupe@x.com');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerPasskeyFirst — userAgent forwarded
// ─────────────────────────────────────────────────────────────────────────────

describe('registerPasskeyFirst — userAgent forwarded to createSession', () => {
  it('passes userAgent to createSession when provided (requireVerification=false)', () => {
    const ua = {
      fingerprintId: 'fp-passkey',
      ip: '1.2.3.4',
      description: 'Chrome, , , , Blink, , macOS, , ',
      header: { 'user-agent': { values: ['Mozilla/5.0'] } },
    };
    run({
      fn: 'registerPasskeyFirst',
      request: { url: `${BASE_URL}/signup` },
      provider: 'singleton',
      signupInput: {
        email: 'carol@acme.test',
        firstName: 'Carol',
        lastName: 'Acme',
        requireVerification: false,
        origin: ORIGIN,
        userAgent: ua,
      },
      inspect: { lastCreateSessionOpts: true },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const opts = (verdict.inspect as Record<string, unknown>)?.lastCreateSessionOpts as Record<
        string,
        unknown
      > | null;
      expect(opts?.userAgent).to.deep.eq(ua);
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
// Both require-verification + ALREADY_EXISTS paths emit 'signup.requested' identically.
// ─────────────────────────────────────────────────────────────────────────────

describe('signup register audit-event shape (divergence guard)', () => {
  const base = {
    email: 'dave@acme.test',
    firstName: 'Dave',
    lastName: 'Acme',
    origin: ORIGIN,
  };

  it("registerPasskeyFirst no-verify success emits 'signup.requested' not 'signup.created'", () => {
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
      // carries organization, NOT userId
      expect(requested?.organization).to.eq('org-z');
      expect(requested).to.have.property('actor');
      expect(requested).to.not.have.property('userId');
    });
  });

  it("registerWithPassword no-verify success emits 'signup.created' with {userId, actor}", () => {
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

  it("registerPasskeyFirst requireVerification success emits 'signup.requested' {actor, organization}", () => {
    run({
      fn: 'registerPasskeyFirst',
      request: { url: `${BASE_URL}/signup` },
      provider: 'singleton',
      signupInput: { ...base, organization: 'org-z', requireVerification: true },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.eq('sent-with-session');

      const created = verdict.audit.find((e) => e.event === 'signup.created');
      expect(created).to.be.undefined;

      const requested = verdict.audit.find((e) => e.event === 'signup.requested');
      expect(requested?.outcome).to.eq('success');
      expect(requested?.organization).to.eq('org-z');
    });
  });

  it("registerWithPassword requireVerification success emits 'signup.requested' NOT 'signup.created'", () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        ...base,
        password: 'hunter2hunter2',
        organization: 'org-z',
        requireVerification: true,
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.eq('sent-with-session');

      // With verification ON, the password path also uses 'signup.requested' (NOT 'created').
      const created = verdict.audit.find((e) => e.event === 'signup.created');
      expect(created, 'should NOT emit signup.created when requireVerification=true').to.be
        .undefined;

      const requested = verdict.audit.find((e) => e.event === 'signup.requested');
      expect(requested?.outcome).to.eq('success');
      expect(requested?.organization).to.eq('org-z');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerAndLinkIdp — IdP register+link wiring
// ─────────────────────────────────────────────────────────────────────────────

describe('registerAndLinkIdp', () => {
  const idpBase = {
    email: 'alice@acme.test',
    firstName: 'Alice',
    lastName: 'Acme',
    idpIntentId: 'intent1',
    idpIntentToken: 'tok1',
    idpId: 'idp1',
    idpUserId: 'idpUser1',
    idpUserName: 'alice_idp',
  };

  it('threads the new sessionId into /authorize when a requestId rides in (anti-select_account-loop)', () => {
    run({
      fn: 'registerAndLinkIdp',
      request: { url: `${BASE_URL}/signup` },
      provider: 'singleton',
      signupInput: { ...idpBase, requestId: 'oidc_abc' },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.eq('redirect');
      // The just-created session id must hand back to /authorize so resolveOidc finishes
      // the callback via runCallback instead of bouncing a select_account ceremony to /accounts.
      expect(r.target as string).to.include('/authorize?requestId=oidc_abc');
      expect(r.target as string).to.include('sessionId=');
    });
  });

  it('lands on /signed-in (no sessionId param) when no requestId rides in', () => {
    run({
      fn: 'registerAndLinkIdp',
      request: { url: `${BASE_URL}/signup` },
      provider: 'singleton',
      signupInput: idpBase,
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.eq('redirect');
      expect(r.target).to.eq('/signed-in');
    });
  });

  it('calls addIdpLink once and does NOT pass idpLink to register', () => {
    run({
      fn: 'registerAndLinkIdp',
      request: { url: `${BASE_URL}/signup` },
      provider: 'singleton',
      signupInput: idpBase,
      recordCalls: ['register', 'addIdpLink'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const calls = verdict.calls as Record<string, unknown[][]>;
      // addIdpLink called exactly once
      expect(calls['addIdpLink']).to.have.length(1);
      // register input must NOT carry an idpLink field
      // calls['register'][n] is the args array; [0][0] accesses the first arg of the first call.
      const registerInput =
        (calls['register']?.[0]?.[0] as unknown as Record<string, unknown>) ?? {};
      expect(registerInput).to.not.have.property('idpLink');
    });
  });

  it('forwards userAgent to createSession (idp path)', () => {
    const ua = {
      fingerprintId: 'fp-idp',
      ip: '1.2.3.4',
      description: 'Chrome, , , , Blink, , macOS, , ',
      header: { 'user-agent': { values: ['Mozilla/5.0'] } },
    };
    run({
      fn: 'registerAndLinkIdp',
      request: { url: `${BASE_URL}/signup` },
      provider: 'singleton',
      signupInput: { ...idpBase, userAgent: ua },
      inspect: { lastCreateSessionOpts: true },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const opts = (verdict.inspect as Record<string, unknown>)?.lastCreateSessionOpts as Record<
        string,
        unknown
      > | null;
      expect(opts?.userAgent).to.deep.eq(ua);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// completeEmailLinkSignup — verifies email, enrolls otpEmail, self-authenticates
//
// The fake seeds emailCodes for constructor-seeded users: emailCodes.set(u.id, `email-${u.id}`).
// We seed a user with a known id so the verifyEmail code is deterministic.
// ─────────────────────────────────────────────────────────────────────────────

describe('completeEmailLinkSignup', () => {
  it('verifies email, enrolls otpEmail, self-authenticates, returns redirect + session', () => {
    const userId = 'u1';
    const verifyCode = `email-${userId}`;
    run({
      fn: 'completeEmailLinkSignup',
      request: { url: `${BASE_URL}/signup/complete` },
      provider: 'fresh',
      // Seeding the user in the constructor causes emailCodes.set('u1', 'email-u1').
      seed: { users: [{ id: userId, loginName: 'new@x.com', displayName: 'New User' }] },
      signupInput: {
        email: 'new@x.com',
        firstName: 'New',
        lastName: 'User',
        userId,
        code: verifyCode,
        loginName: 'new@x.com',
        next: 'passkey',
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.eq('redirect');
      expect(r.target as string).to.include('/setup/passkey');
      expect(r.target as string).to.include('checkAfter=false');
      const sessions = r.sessions as unknown[];
      expect(sessions).to.have.length(1);
    });
  });

  it('emits signup.created audit event', () => {
    const userId = 'u2';
    const verifyCode = `email-${userId}`;
    run({
      fn: 'completeEmailLinkSignup',
      request: { url: `${BASE_URL}/signup/complete` },
      provider: 'fresh',
      seed: { users: [{ id: userId, loginName: 'audit@x.com', displayName: 'Audit User' }] },
      signupInput: {
        email: 'audit@x.com',
        firstName: 'Audit',
        lastName: 'User',
        userId,
        code: verifyCode,
        loginName: 'audit@x.com',
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const created = verdict.audit.find((e) => e.event === 'signup.created');
      expect(created?.outcome).to.eq('success');
      expect(created?.userId).to.eq(userId);
    });
  });

  it('forwards userAgent to createSession (completeEmailLink path)', () => {
    const ua = {
      fingerprintId: 'fp-complete',
      ip: '1.2.3.4',
      description: 'Chrome, , , , Blink, , macOS, , ',
      header: { 'user-agent': { values: ['Mozilla/5.0'] } },
    };
    const userId = 'u3';
    run({
      fn: 'completeEmailLinkSignup',
      request: { url: `${BASE_URL}/signup/complete` },
      provider: 'fresh',
      seed: { users: [{ id: userId, loginName: 'ua@x.com', displayName: 'UA User' }] },
      signupInput: {
        email: 'ua@x.com',
        firstName: 'UA',
        lastName: 'User',
        userId,
        code: `email-${userId}`,
        loginName: 'ua@x.com',
        userAgent: ua,
      },
      inspect: { lastCreateSessionOpts: true },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const opts = (verdict.inspect as Record<string, unknown>)?.lastCreateSessionOpts as Record<
        string,
        unknown
      > | null;
      expect(opts?.userAgent).to.deep.eq(ua);
    });
  });
});
