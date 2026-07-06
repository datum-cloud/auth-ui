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

  it('emits an mfa_method_chosen failure audit line when findUser throws', () => {
    callService(scenario).then((v) => {
      const failure = v.audit.find(
        (e) => e.event === 'mfa_method_chosen' && e.outcome === 'failure'
      );
      expect(failure, 'a failure audit event').to.not.equal(undefined);
    });
  });

  it('still emits the success routing event even when findUser throws (routing continues)', () => {
    callService(scenario).then((v) => {
      const success = v.audit.find(
        (e) => e.event === 'mfa_method_chosen' && e.outcome === 'success'
      );
      expect(success, 'the success routing event').to.not.equal(undefined);
      // routing still resolves a use-screen target.
      const o = v.outcome as { ok: boolean; target?: string };
      expect(o.ok).to.equal(true);
      expect(o.target ?? '').to.include('/login/verify/authenticator');
    });
  });

  it('does NOT put raw loginName in the failure audit fields (hashed actor only)', () => {
    callService(scenario).then((v) => {
      const failure = v.audit.find(
        (e) => e.event === 'mfa_method_chosen' && e.outcome === 'failure'
      );
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

  it('returns a redirect (not setup) when no MFA methods are offerable', () => {
    callService(baseScenario).then((v) => {
      const o = v.outcome as { kind: string; offerableKeys?: unknown[] };
      expect(o.kind, 'auto-skip: kind must be redirect, not setup').to.equal('redirect');
    });
  });

  it('redirect target does not loop back to /setup/mfa', () => {
    callService(baseScenario).then((v) => {
      const o = v.outcome as { kind: string; target?: string };
      expect(o.target ?? '', 'target must not loop back to /setup/mfa').to.not.include(
        '/setup/mfa'
      );
    });
  });

  it('emits an mfa_skip success audit line on auto-skip', () => {
    callService(baseScenario).then((v) => {
      const skipAudit = v.audit.find((e) => e.event === 'mfa_skip' && e.outcome === 'success');
      expect(skipAudit, 'mfa_skip success audit must be emitted').to.not.equal(undefined);
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

  it('returns kind: setup (not redirect) when offerable MFA methods exist', () => {
    callService(scenario).then((v) => {
      const o = v.outcome as { kind: string; offerableKeys?: string[] };
      expect(o.kind, 'chooser renders when methods available').to.equal('setup');
    });
  });

  it('offerableKeys is non-empty when MFA capabilities are enabled', () => {
    callService(scenario).then((v) => {
      const o = v.outcome as { kind: string; offerableKeys?: string[] };
      expect((o.offerableKeys ?? []).length, 'offerable keys non-empty').to.be.greaterThan(0);
    });
  });
});
