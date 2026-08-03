// cypress/component/resources/mfa/mfa.service.cy.ts
//
// cy.task node-spec port of the SESSION-BOUND mfa service tests:
//   - choose-mfa-method.service.test.ts  (chooseMfaMethod findUser-failure audit)
//   - resolveMfaSetup auto-skip: when no MFA methods are offerable, the loader must
//     redirect instead of rendering an empty chooser.
//
// These read an already-read SessionEntry[] and emit REAL audit via logAuthEvent (→ console.log,
// captured by the harness). The browser bundle stubs observability to a no-op, so they must run
// node-side against the richly-seeded fake singleton (u1 alice, u7 mfa2-user, totp-only-org).
import { callService } from '../../../support/node/call-service';

describe('chooseMfaMethod — findUser failure audit (security: routing continues, no PII leak)', () => {
  const scenario = {
    fn: 'chooseMfaMethod' as const,
    provider: 'singleton' as const,
    failFindUser: true,
    request: {
      url: 'http://localhost/id/login/mfa',
      sessions: [{ id: 's1', token: 't1', loginName: 'alice@acme.test' }],
      form: { loginName: 'alice@acme.test', method: 'totp' },
    },
    mfaInput: { loginName: 'alice@acme.test' },
  };

  // All three assertions read DIFFERENT fields of the SAME verdict — the scenario was being
  // re-run identically three times. One run, all assertions.
  it('audits a findUser failure with a hashed actor, and still routes to the use-screen', () => {
    callService(scenario).then((v) => {
      const failure = v.audit.find(
        (e) => e.event === 'mfa_method_chosen' && e.outcome === 'failure'
      );
      expect(failure, 'a failure audit event').to.not.equal(undefined);

      const success = v.audit.find(
        (e) => e.event === 'mfa_method_chosen' && e.outcome === 'success'
      );
      expect(success, 'the success routing event').to.not.equal(undefined);
      // routing still resolves a use-screen target.
      const o = v.outcome as { ok: boolean; target?: string };
      expect(o.ok).to.equal(true);
      expect(o.target ?? '').to.include('/login/verify/authenticator');

      // No PII leak: the failure line must carry a hashed actor, never the raw loginName.
      expect(failure?.loginName, 'no raw loginName').to.equal(undefined);
      expect(typeof failure?.actor, 'hashed actor present').to.equal('string');
    });
  });
});

// ── resolveMfaSetup: auto-skip when no MFA methods are offerable ────────────────────────────────
//
// Root cause (fixed): when offerableSetupRoutes returns [], resolveMfaSetup used to return
// { kind: 'setup', offerableKeys: [] } — rendering an empty chooser. Under force=true, the
// Skip button is hidden, leaving the user stuck.
//
// Fix: an empty offerable set → stamp the skip (setMfaInitSkipped, same as the manual skip path)
// and return { kind: 'redirect', target } so the loader auto-advances. Stamping is required to
// prevent a re-prompt loop (nextStep re-routes to /setup/mfa when mfaInitSkippedAt is null).
//
// The fresh provider seed uses capabilities: { passkey: false, totpOtp: false, emailOtp: false,
// u2f: false, smsOtp: false } so offerableSetupRoutes returns [] regardless of policy. The
// live session is seeded via `liveSessions` so getSession(entry.id, entry.token) resolves
// (required by the auto-skip nextStepFromSession call inside resolveMfaSetup).

describe('resolveMfaSetup — auto-skip when no MFA methods are offerable', () => {
  // A fresh provider with all MFA capabilities disabled and one password-only user.
  const NO_MFA_CAPS = {
    passkey: false,
    u2f: false,
    totpOtp: false,
    emailOtp: false,
    smsOtp: false,
    externalIdp: false,
    ldap: false,
    saml: false,
    oidc: false,
    registration: false,
  };

  const baseScenario = {
    fn: 'resolveMfaSetup' as const,
    provider: 'fresh' as const,
    seed: {
      users: [{ id: 'u-nomfa', loginName: 'nomfa@test.example' }],
      authMethods: { 'u-nomfa': ['password'] as string[] },
      capabilities: NO_MFA_CAPS,
    },
    liveSessions: [
      {
        id: 'sess-nomfa',
        token: 'tok-nomfa',
        user: { id: 'u-nomfa', loginName: 'nomfa@test.example' },
      },
    ],
    request: {
      url: 'http://localhost/id/setup/mfa',
      sessions: [{ id: 'sess-nomfa', token: 'tok-nomfa', loginName: 'nomfa@test.example' }],
    },
    mfaInput: { loginName: 'nomfa@test.example' },
  };

  // Three assertions on three fields of the SAME verdict — one run instead of three.
  it('returns a redirect (not setup) whose target does not loop back to /setup/mfa, and emits an mfa_skip success audit line', () => {
    callService(baseScenario).then((v) => {
      const o = v.outcome as { kind: string; target?: string; offerableKeys?: unknown[] };
      expect(o.kind, 'auto-skip: kind must be redirect, not setup').to.equal('redirect');
      expect(o.target ?? '', 'target must not loop back to /setup/mfa').to.not.include(
        '/setup/mfa'
      );

      // Stamping the skip is what prevents a re-prompt loop.
      const skipAudit = v.audit.find((e) => e.event === 'mfa_skip' && e.outcome === 'success');
      expect(skipAudit, 'mfa_skip success audit must be emitted').to.not.equal(undefined);
    });
  });
});

// ── resolveMfaSetup: auto-skip threads requestId into redirect target ───────────────────────────
//
// Regression guard: when resolveMfaSetup auto-skips (no offerable MFA methods), the resulting
// redirect target MUST carry the requestId so the OIDC/SAML ceremony can resume. Without it,
// nextStepFromSession builds a target without the requestId query param → the handback to the
// IdP is broken → staging returns /id/error?code=signin_failed after Google IdP login.
//
// REQUEST_ID_PATTERN in next-step only threads ids matching oidc_*/saml_*/device_* prefixes,
// so we use 'oidc_test123' to exercise the actual threading path.

describe('resolveMfaSetup — auto-skip threads requestId into the redirect target', () => {
  const NO_MFA_CAPS = {
    passkey: false,
    u2f: false,
    totpOtp: false,
    emailOtp: false,
    smsOtp: false,
    externalIdp: false,
    ldap: false,
    saml: false,
    oidc: false,
    registration: false,
  };

  const scenarioWithRequestId = {
    fn: 'resolveMfaSetup' as const,
    provider: 'fresh' as const,
    seed: {
      users: [{ id: 'u-nomfa2', loginName: 'nomfa2@test.example' }],
      authMethods: { 'u-nomfa2': ['password'] as string[] },
      capabilities: NO_MFA_CAPS,
    },
    liveSessions: [
      {
        id: 'sess-nomfa2',
        token: 'tok-nomfa2',
        user: { id: 'u-nomfa2', loginName: 'nomfa2@test.example' },
      },
    ],
    request: {
      url: 'http://localhost/id/setup/mfa',
      sessions: [{ id: 'sess-nomfa2', token: 'tok-nomfa2', loginName: 'nomfa2@test.example' }],
    },
    mfaInput: { loginName: 'nomfa2@test.example', requestId: 'oidc_test123' },
  };

  it('redirect target includes requestId=oidc_test123 so the OIDC ceremony can resume', () => {
    callService(scenarioWithRequestId).then((v) => {
      const o = v.outcome as { kind: string; target?: string };
      expect(o.kind, 'auto-skip: kind must be redirect').to.equal('redirect');
      expect(o.target ?? '', 'target must carry requestId').to.include('requestId=oidc_test123');
    });
  });
});

// ── resolveMfaSetup: normal path (non-empty offerable set) still returns offerableKeys ──────────
//
// Regression guard: ensure the fix does not break the normal chooser path where MFA methods ARE
// available. Uses the singleton provider which has totpOtp + emailOtp + passkey capabilities.

describe('resolveMfaSetup — normal path returns offerableKeys when MFA methods exist', () => {
  const scenario = {
    fn: 'resolveMfaSetup' as const,
    provider: 'singleton' as const,
    liveSessions: [
      {
        id: 's-alice-setup',
        token: 't-alice-setup',
        user: { id: 'u1', loginName: 'alice@acme.test' },
      },
    ],
    request: {
      url: 'http://localhost/id/setup/mfa',
      sessions: [{ id: 's-alice-setup', token: 't-alice-setup', loginName: 'alice@acme.test' }],
    },
    mfaInput: { loginName: 'alice@acme.test' },
  };

  // Both assertions read the SAME verdict — one run instead of two.
  it('returns kind: setup (not redirect) with a non-empty offerableKeys when MFA capabilities are enabled', () => {
    callService(scenario).then((v) => {
      const o = v.outcome as { kind: string; offerableKeys?: string[] };
      expect(o.kind, 'chooser renders when methods available').to.equal('setup');
      expect((o.offerableKeys ?? []).length, 'offerable keys non-empty').to.be.greaterThan(0);
    });
  });
});
