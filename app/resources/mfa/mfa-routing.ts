import { passwordlessPasskeyFresh, secondFactorFresh } from '@/resources/shared/lifetimes';
import type { AuthMethod, Factors, LoginSettings } from '@/modules/auth/types';

export interface MfaRoutingInput {
  factors: Factors;
  enrolledMethods: AuthMethod[]; // from listAuthMethods(userId)
  settings: LoginSettings;
  nowMs: number; // injected — no Date.now() here
  loginName: string;
  userVerified: boolean; // session.factors.passkey was user-verified
  mfaInitSkippedAt: string | null; // ISO or null (from neutral User)
  requestId?: string;
  organization?: string;
}

export type MfaRoutingResult =
  | { kind: 'done' }
  | { kind: 'route'; path: string; params: Record<string, string> };

// Note: AuthMethod uses snake_case ('otp_email') while Factors keys use camelCase ('otpEmail') —
// separate concerns; do not conflate. The allow-list below intentionally excludes
// password/passkey/idp (and any future AuthMethod) from the 2nd-factor count.
export const SECOND_FACTOR_METHODS = ['totp', 'otp_email', 'otp_sms', 'u2f'] as const;
export type SecondFactorMethod = (typeof SECOND_FACTOR_METHODS)[number];

export const USE_SCREEN: Record<SecondFactorMethod, string> = {
  totp: '/login/verify/authenticator',
  otp_email: '/login/verify/email',
  otp_sms: '/login/verify/sms',
  u2f: '/login/security-key',
};

/**
 * Bug C: intersect the user's enrolled second factors with the org login policy's allowed
 * `secondFactors` so a policy-disabled-but-still-enrolled method (e.g. OTP-Email after the type
 * was disabled) is never offered. A non-empty policy restricts; undefined/empty policy signals
 * "no restriction" → return `enrolled` unchanged (back-compat for fake/older settings).
 *
 * Single source of truth for this gate — used by both nextMfaStep and the /login/mfa loader so
 * the two sites cannot drift on the back-compat semantics.
 */
export function intersectWithPolicy<T extends string>(
  enrolled: readonly T[],
  policy: readonly string[] | undefined
): T[] {
  // Filter `enrolled` (so the narrower element type T is preserved) against the wider policy set.
  return policy && policy.length > 0 ? enrolled.filter((m) => policy.includes(m)) : [...enrolled];
}

function baseParams(input: MfaRoutingInput): Record<string, string> {
  const p: Record<string, string> = { loginName: input.loginName };
  if (input.requestId) p.requestId = input.requestId;
  if (input.organization) p.organization = input.organization;
  return p;
}

export function nextMfaStep(input: MfaRoutingInput): MfaRoutingResult {
  const { factors, settings, nowMs } = input;

  // 1. Passwordless passkey satisfies MFA outright.
  if (
    passwordlessPasskeyFresh(
      factors,
      input.userVerified,
      nowMs,
      settings.multiFactorCheckLifetimeMs
    )
  ) {
    return { kind: 'done' };
  }

  // 2. A still-fresh second factor satisfies MFA.
  if (secondFactorFresh(factors, nowMs, settings.secondFactorCheckLifetimeMs)) {
    return { kind: 'done' };
  }

  // 3/4. Route by number of enrolled 2nd-factor methods (password/passkey/idp excluded).
  const enrolled = input.enrolledMethods.filter((m): m is SecondFactorMethod =>
    (SECOND_FACTOR_METHODS as readonly string[]).includes(m)
  );
  // Bug C: gate by the org login policy's allowed second factors (shared helper — see
  // intersectWithPolicy). Empty intersection falls through to the setup steps below =
  // skippable new-factor enrollment.
  const available = intersectWithPolicy(enrolled, settings.secondFactors);
  if (available.length === 1) {
    return { kind: 'route', path: USE_SCREEN[available[0]], params: baseParams(input) };
  }
  if (available.length > 1) {
    return { kind: 'route', path: '/login/mfa', params: baseParams(input) };
  }

  // 5. No 2nd factor enrolled + forced ⇒ forced setup.
  if (settings.forceMfa) {
    return {
      kind: 'route',
      path: '/setup/mfa',
      params: { ...baseParams(input), force: 'true', checkAfter: 'true' },
    };
  }

  // 6. Skippable setup prompt, gated by the skip lifetime.
  const skipMs = settings.mfaInitSkipLifetimeMs;
  if (skipMs) {
    const skippedAt = input.mfaInitSkippedAt ? Date.parse(input.mfaInitSkippedAt) : NaN;
    const skipStillFresh = !Number.isNaN(skippedAt) && nowMs - skippedAt <= skipMs;
    if (!skipStillFresh) {
      return {
        kind: 'route',
        path: '/setup/mfa',
        params: { ...baseParams(input), force: 'false', checkAfter: 'true' },
      };
    }
  }

  // 7. Nothing to do — MFA satisfied.
  return { kind: 'done' };
}
