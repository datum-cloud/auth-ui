import { nextMfaStep, intersectWithPolicy, type MfaRoutingInput } from '../mfa-routing';
import type { AuthMethod, Factors, LoginSettings } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const fresh = '2026-01-01T00:00:00.000Z'; // ISO — mfaInitSkippedAt stays a string
const freshDate = new Date(fresh); // factor verifiedAt is now Date | null
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
    ).toEqual({ kind: 'done' });
  });

  it('NOT done when passkey fresh but NOT user-verified (falls through to enrolled-method routing)', () => {
    const factors: Factors = { passkey: { verifiedAt: freshDate } };
    const r = nextMfaStep(base({ factors, userVerified: false, enrolledMethods: ['totp'] }));
    expect(r).toMatchObject({ kind: 'route', path: '/login/verify/authenticator' });
  });

  it('done when a second factor (totp) is already fresh', () => {
    const factors: Factors = { totp: { verifiedAt: freshDate } };
    expect(
      nextMfaStep(base({ factors, settings: settings({ secondFactorCheckLifetimeMs: 1000 }) }))
    ).toEqual({ kind: 'done' });
  });

  it('NOT done when the only fresh second factor is stale', () => {
    const factors: Factors = { totp: { verifiedAt: freshDate } };
    const r = nextMfaStep(
      base({
        factors,
        enrolledMethods: ['totp'],
        nowMs: T0 + 5000,
        settings: settings({ secondFactorCheckLifetimeMs: 1000 }),
      })
    );
    expect(r).toMatchObject({ kind: 'route', path: '/login/verify/authenticator' });
  });

  it.each<[AuthMethod, string]>([
    ['totp', '/login/verify/authenticator'],
    ['otp_email', '/login/verify/email'],
    ['otp_sms', '/login/verify/sms'],
    ['u2f', '/login/security-key'],
  ])('routes directly to %s use-screen when it is the only enrolled 2nd factor', (method, path) => {
    expect(nextMfaStep(base({ enrolledMethods: [method] }))).toMatchObject({ kind: 'route', path });
  });

  it('excludes password and passkey from the "enrolled 2nd factor" count', () => {
    // password+passkey+totp enrolled ⇒ only totp counts ⇒ single-method direct route
    expect(nextMfaStep(base({ enrolledMethods: ['password', 'passkey', 'totp'] }))).toMatchObject({
      kind: 'route',
      path: '/login/verify/authenticator',
    });
  });

  it('routes to /login/mfa when more than one 2nd factor is enrolled', () => {
    expect(nextMfaStep(base({ enrolledMethods: ['totp', 'otp_email'] }))).toMatchObject({
      kind: 'route',
      path: '/login/mfa',
    });
  });

  it('routes to /setup/mfa (force=true,checkAfter=true) when forceMfa and no 2nd factor enrolled', () => {
    const r = nextMfaStep(base({ settings: settings({ forceMfa: true }) }));
    expect(r).toMatchObject({
      kind: 'route',
      path: '/setup/mfa',
      params: { force: 'true', checkAfter: 'true' },
    });
  });

  it('routes to /setup/mfa (force=false) when not forced but skip window set and user never skipped', () => {
    const r = nextMfaStep(
      base({ settings: settings({ mfaInitSkipLifetimeMs: 10_000 }), mfaInitSkippedAt: null })
    );
    expect(r).toMatchObject({
      kind: 'route',
      path: '/setup/mfa',
      params: { force: 'false', checkAfter: 'true' },
    });
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
    ).toEqual({ kind: 'done' });
  });

  it('re-prompts (/setup/mfa) when skip window set and last skip has expired', () => {
    const r = nextMfaStep(
      base({
        settings: settings({ mfaInitSkipLifetimeMs: 10_000 }),
        mfaInitSkippedAt: fresh,
        nowMs: T0 + 20_000,
      })
    );
    expect(r).toMatchObject({ kind: 'route', path: '/setup/mfa' });
  });

  it('is done when no 2nd factor enrolled, not forced, and no skip window configured', () => {
    expect(nextMfaStep(base())).toEqual({ kind: 'done' });
  });

  it('treats an empty-string mfaInitSkippedAt as never-skipped (re-prompts)', () => {
    const r = nextMfaStep(
      base({ settings: settings({ mfaInitSkipLifetimeMs: 10_000 }), mfaInitSkippedAt: '' })
    );
    expect(r).toMatchObject({ kind: 'route', path: '/setup/mfa' });
  });

  it('threads loginName, requestId and organization into route params', () => {
    const r = nextMfaStep(
      base({ enrolledMethods: ['totp'], requestId: 'oidc_x', organization: 'org1' })
    );
    expect(r).toMatchObject({
      kind: 'route',
      path: '/login/verify/authenticator',
      params: { loginName: 'a@acme.test', requestId: 'oidc_x', organization: 'org1' },
    });
  });

  // ── Bug C: intersect enrolled methods with policy-allowed secondFactors ──────

  it('drops a policy-disabled enrolled factor and routes to the remaining allowed one', () => {
    // enrolled [otp_email, totp] but policy only allows [totp] → routes to TOTP.
    const r = nextMfaStep(
      base({
        enrolledMethods: ['otp_email', 'totp'],
        settings: settings({ secondFactors: ['totp'] }),
      })
    );
    expect(r).toMatchObject({ kind: 'route', path: '/login/verify/authenticator' });
  });

  it('falls to setup when the only enrolled factor is policy-disabled (empty intersection escape hatch)', () => {
    // enrolled [otp_email] only, policy allows [totp] → empty intersection → skippable setup.
    const r = nextMfaStep(
      base({
        enrolledMethods: ['otp_email'],
        settings: settings({ secondFactors: ['totp'], forceMfa: true }),
      })
    );
    expect(r).toMatchObject({ kind: 'route', path: '/setup/mfa' });
  });

  it('keeps enrolled-only routing when policy secondFactors is undefined (back-compat)', () => {
    // No secondFactors on settings → today's behavior: enrolled [otp_email] routes to email.
    const r = nextMfaStep(base({ enrolledMethods: ['otp_email'] }));
    expect(r).toMatchObject({ kind: 'route', path: '/login/verify/email' });
  });

  it('keeps enrolled-only routing when policy secondFactors is empty (treats as unset, back-compat)', () => {
    // Empty array = no policy restriction signalled → enrolled-only.
    const r = nextMfaStep(
      base({ enrolledMethods: ['otp_email'], settings: settings({ secondFactors: [] }) })
    );
    expect(r).toMatchObject({ kind: 'route', path: '/login/verify/email' });
  });

  // ── 755-M10: suppressMfaSetupNudge (account-switch) ──────────────────────────

  it('suppresses ONLY the step-6 skippable nudge when suppressMfaSetupNudge is set (→ done)', () => {
    // Same input that re-prompts on a fresh login (skip window set, never skipped, no factors),
    // but with the switch-context flag → done instead of /setup/mfa?force=false.
    const r = nextMfaStep(
      base({
        settings: settings({ mfaInitSkipLifetimeMs: 10_000 }),
        mfaInitSkippedAt: null,
        suppressMfaSetupNudge: true,
      })
    );
    expect(r).toEqual({ kind: 'done' });
  });

  it('still routes to FORCED setup (step 5) even when suppressMfaSetupNudge is set', () => {
    // forceMfa is a REAL requirement (step 5) — the switch suppression must NOT skip it.
    const r = nextMfaStep(
      base({ settings: settings({ forceMfa: true }), suppressMfaSetupNudge: true })
    );
    expect(r).toMatchObject({
      kind: 'route',
      path: '/setup/mfa',
      params: { force: 'true', checkAfter: 'true' },
    });
  });

  it('still routes to a real challenge (steps 1–4) even when suppressMfaSetupNudge is set', () => {
    // A single enrolled, unverified 2nd factor is a real challenge — suppression must not skip it.
    const r = nextMfaStep(base({ enrolledMethods: ['totp'], suppressMfaSetupNudge: true }));
    expect(r).toMatchObject({ kind: 'route', path: '/login/verify/authenticator' });
  });

  // ── FlowContext is threaded as the mfa role (behavior-neutral) ──────────
  it('routes otp_email as a SECOND FACTOR (mfa role) to /login/verify/email — same target, typed role', () => {
    // otp_email lives in BOTH PrimaryAuthMethod and SecondFactorMethod; here the mfa-role
    // context pins it as a second factor. Target is identical to the primary-role route, but
    // the role is explicit at the type boundary rather than inferred from a sentinel param.
    const r = nextMfaStep(base({ context: { role: 'mfa' }, enrolledMethods: ['otp_email'] }));
    expect(r).toMatchObject({ kind: 'route', path: '/login/verify/email' });
  });
});

describe('intersectWithPolicy', () => {
  it('intersects enrolled with the policy when the policy is non-empty', () => {
    expect(intersectWithPolicy(['totp', 'otp_email', 'u2f'], ['totp', 'u2f'])).toEqual([
      'totp',
      'u2f',
    ]);
  });

  it('preserves enrolled order (filters enrolled, not policy)', () => {
    expect(intersectWithPolicy(['otp_email', 'totp'], ['totp', 'otp_email'])).toEqual([
      'otp_email',
      'totp',
    ]);
  });

  it('returns enrolled unchanged when the policy is undefined (back-compat)', () => {
    expect(intersectWithPolicy(['totp', 'otp_email'], undefined)).toEqual(['totp', 'otp_email']);
  });

  it('returns enrolled unchanged when the policy is empty (treated as unset, back-compat)', () => {
    expect(intersectWithPolicy(['totp', 'otp_email'], [])).toEqual(['totp', 'otp_email']);
  });

  it('returns an empty array when no enrolled method is policy-allowed', () => {
    expect(intersectWithPolicy(['otp_email'], ['totp'])).toEqual([]);
  });
});
