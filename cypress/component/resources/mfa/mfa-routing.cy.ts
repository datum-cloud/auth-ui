// cypress/component/resources/mfa/mfa-routing.cy.ts
//
// Component (no-mount) port of app/resources/mfa/__tests__/mfa-routing.test.ts.
// nextMfaStep + intersectWithPolicy are PURE (plain MfaRoutingInput in, decision out) — no
// provider, no cookie, no Request — so they run browser-side with Chai. This is the MFA routing
// security gate (which factor screen a login lands on), kept as a fast structural spec.
import type { AuthMethod, Factors, LoginSettings } from '@/modules/auth/types';
import {
  nextMfaStep,
  intersectWithPolicy,
  type MfaRoutingInput,
} from '@/resources/mfa/mfa-routing';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const fresh = '2026-01-01T00:00:00.000Z'; // ISO — mfaInitSkippedAt stays a string
const freshDate = new Date(fresh); // factor verifiedAt is Date | null

const settings = (over: Partial<LoginSettings> = {}): LoginSettings => ({
  allowPassword: true,
  allowRegister: true,
  allowExternalIdp: true,
  passkeysType: 'allowed',
  forceMfa: false,
  ...over,
});

const base = (over: Partial<MfaRoutingInput> = {}): MfaRoutingInput => ({
  factors: {},
  enrolledMethods: [],
  settings: settings(),
  nowMs: T0 + 100,
  loginName: 'a@acme.test',
  userVerified: false,
  mfaInitSkippedAt: null,
  context: { role: 'mfa' }, // nextMfaStep always runs in the mfa role
  ...over,
});

/** Narrow + assert a route result (Chai has no toMatchObject — assert the fields explicitly). */
function expectRoute(
  r: ReturnType<typeof nextMfaStep>,
  path: string,
  params?: Record<string, string>
): void {
  expect(r.kind).to.equal('route');
  if (r.kind !== 'route') return;
  expect(r.path).to.equal(path);
  if (params) expect(r.params).to.include(params);
}

describe('nextMfaStep', () => {
  it('done when a passwordless passkey is user-verified and fresh', () => {
    const factors: Factors = { passkey: { verifiedAt: freshDate } };
    expect(
      nextMfaStep(
        base({
          factors,
          userVerified: true,
          settings: settings({ multiFactorCheckLifetimeMs: 1000 }),
        })
      )
    ).to.deep.equal({ kind: 'done' });
  });

  it('NOT done when passkey fresh but NOT user-verified (falls through to enrolled-method routing)', () => {
    const factors: Factors = { passkey: { verifiedAt: freshDate } };
    expectRoute(
      nextMfaStep(base({ factors, userVerified: false, enrolledMethods: ['totp'] })),
      '/login/verify/authenticator'
    );
  });

  it('done when a second factor (totp) is already fresh', () => {
    const factors: Factors = { totp: { verifiedAt: freshDate } };
    expect(
      nextMfaStep(base({ factors, settings: settings({ secondFactorCheckLifetimeMs: 1000 }) }))
    ).to.deep.equal({ kind: 'done' });
  });

  it('NOT done when the only fresh second factor is stale', () => {
    const factors: Factors = { totp: { verifiedAt: freshDate } };
    expectRoute(
      nextMfaStep(
        base({
          factors,
          enrolledMethods: ['totp'],
          nowMs: T0 + 5000,
          settings: settings({ secondFactorCheckLifetimeMs: 1000 }),
        })
      ),
      '/login/verify/authenticator'
    );
  });

  const directRoutes: Array<[AuthMethod, string]> = [
    ['totp', '/login/verify/authenticator'],
    ['otp_email', '/login/verify/email'],
    ['otp_sms', '/login/verify/sms'],
    ['u2f', '/login/security-key'],
  ];
  directRoutes.forEach(([method, path]) => {
    it(`routes directly to ${method} use-screen when it is the only enrolled 2nd factor`, () => {
      expectRoute(nextMfaStep(base({ enrolledMethods: [method] })), path);
    });
  });

  it('excludes password and passkey from the "enrolled 2nd factor" count', () => {
    expectRoute(
      nextMfaStep(base({ enrolledMethods: ['password', 'passkey', 'totp'] })),
      '/login/verify/authenticator'
    );
  });

  it('routes to /login/mfa when more than one 2nd factor is enrolled', () => {
    expectRoute(nextMfaStep(base({ enrolledMethods: ['totp', 'otp_email'] })), '/login/mfa');
  });

  it('routes to /setup/mfa (force=true,checkAfter=true) when forceMfa and no 2nd factor enrolled', () => {
    expectRoute(nextMfaStep(base({ settings: settings({ forceMfa: true }) })), '/setup/mfa', {
      force: 'true',
      checkAfter: 'true',
    });
  });

  it('routes to /setup/mfa (force=false) when not forced but skip window set and user never skipped', () => {
    expectRoute(
      nextMfaStep(
        base({ settings: settings({ mfaInitSkipLifetimeMs: 10_000 }), mfaInitSkippedAt: null })
      ),
      '/setup/mfa',
      { force: 'false', checkAfter: 'true' }
    );
  });

  it('is done when skip window set and last skip is still fresh', () => {
    expect(
      nextMfaStep(
        base({
          settings: settings({ mfaInitSkipLifetimeMs: 10_000 }),
          mfaInitSkippedAt: fresh,
          nowMs: T0 + 5_000,
        })
      )
    ).to.deep.equal({ kind: 'done' });
  });

  it('re-prompts (/setup/mfa) when skip window set and last skip has expired', () => {
    expectRoute(
      nextMfaStep(
        base({
          settings: settings({ mfaInitSkipLifetimeMs: 10_000 }),
          mfaInitSkippedAt: fresh,
          nowMs: T0 + 20_000,
        })
      ),
      '/setup/mfa'
    );
  });

  it('is done when no 2nd factor enrolled, not forced, and no skip window configured', () => {
    expect(nextMfaStep(base())).to.deep.equal({ kind: 'done' });
  });

  it('treats an empty-string mfaInitSkippedAt as never-skipped (re-prompts)', () => {
    expectRoute(
      nextMfaStep(
        base({ settings: settings({ mfaInitSkipLifetimeMs: 10_000 }), mfaInitSkippedAt: '' })
      ),
      '/setup/mfa'
    );
  });

  it('threads loginName, requestId and organization into route params', () => {
    expectRoute(
      nextMfaStep(base({ enrolledMethods: ['totp'], requestId: 'oidc_x', organization: 'org1' })),
      '/login/verify/authenticator',
      { loginName: 'a@acme.test', requestId: 'oidc_x', organization: 'org1' }
    );
  });

  // ── Bug C: intersect enrolled methods with policy-allowed secondFactors ──────

  it('drops a policy-disabled enrolled factor and routes to the remaining allowed one', () => {
    expectRoute(
      nextMfaStep(
        base({
          enrolledMethods: ['otp_email', 'totp'],
          settings: settings({ secondFactors: ['totp'] }),
        })
      ),
      '/login/verify/authenticator'
    );
  });

  it('falls to setup when the only enrolled factor is policy-disabled (empty intersection escape hatch)', () => {
    expectRoute(
      nextMfaStep(
        base({
          enrolledMethods: ['otp_email'],
          settings: settings({ secondFactors: ['totp'], forceMfa: true }),
        })
      ),
      '/setup/mfa'
    );
  });

  it('keeps enrolled-only routing when policy secondFactors is undefined (back-compat)', () => {
    expectRoute(nextMfaStep(base({ enrolledMethods: ['otp_email'] })), '/login/verify/email');
  });

  it('keeps enrolled-only routing when policy secondFactors is empty (treats as unset, back-compat)', () => {
    expectRoute(
      nextMfaStep(
        base({ enrolledMethods: ['otp_email'], settings: settings({ secondFactors: [] }) })
      ),
      '/login/verify/email'
    );
  });

  // ── 755-M10: suppressMfaSetupNudge (account-switch) ──────────────────────────

  it('suppresses ONLY the step-6 skippable nudge when suppressMfaSetupNudge is set (→ done)', () => {
    expect(
      nextMfaStep(
        base({
          settings: settings({ mfaInitSkipLifetimeMs: 10_000 }),
          mfaInitSkippedAt: null,
          suppressMfaSetupNudge: true,
        })
      )
    ).to.deep.equal({ kind: 'done' });
  });

  it('still routes to FORCED setup (step 5) even when suppressMfaSetupNudge is set', () => {
    expectRoute(
      nextMfaStep(base({ settings: settings({ forceMfa: true }), suppressMfaSetupNudge: true })),
      '/setup/mfa',
      { force: 'true', checkAfter: 'true' }
    );
  });

  it('still routes to a real challenge (steps 1–4) even when suppressMfaSetupNudge is set', () => {
    expectRoute(
      nextMfaStep(base({ enrolledMethods: ['totp'], suppressMfaSetupNudge: true })),
      '/login/verify/authenticator'
    );
  });

  it('routes otp_email as a SECOND FACTOR (mfa role) to /login/verify/email — same target, typed role', () => {
    expectRoute(
      nextMfaStep(base({ context: { role: 'mfa' }, enrolledMethods: ['otp_email'] })),
      '/login/verify/email'
    );
  });
});

describe('intersectWithPolicy', () => {
  it('intersects enrolled with the policy when the policy is non-empty', () => {
    expect(intersectWithPolicy(['totp', 'otp_email', 'u2f'], ['totp', 'u2f'])).to.deep.equal([
      'totp',
      'u2f',
    ]);
  });

  it('preserves enrolled order (filters enrolled, not policy)', () => {
    expect(intersectWithPolicy(['otp_email', 'totp'], ['totp', 'otp_email'])).to.deep.equal([
      'otp_email',
      'totp',
    ]);
  });

  it('returns enrolled unchanged when the policy is undefined (back-compat)', () => {
    expect(intersectWithPolicy(['totp', 'otp_email'], undefined)).to.deep.equal([
      'totp',
      'otp_email',
    ]);
  });

  it('returns enrolled unchanged when the policy is empty (treated as unset, back-compat)', () => {
    expect(intersectWithPolicy(['totp', 'otp_email'], [])).to.deep.equal(['totp', 'otp_email']);
  });

  it('returns an empty array when no enrolled method is policy-allowed', () => {
    expect(intersectWithPolicy(['otp_email'], ['totp'])).to.deep.equal([]);
  });
});
