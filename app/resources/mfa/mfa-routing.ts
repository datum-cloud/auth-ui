import type {
  AuthMethod,
  Factors,
  FlowContext,
  LoginSettings,
  SecondFactorMethod,
} from '@/modules/auth/types';
import { passwordlessPasskeyFresh, secondFactorFresh } from '@/resources/shared/lifetimes';

export interface MfaRoutingInput {
  factors: Factors;
  enrolledMethods: AuthMethod[]; // from listAuthMethods(userId)
  settings: LoginSettings;
  nowMs: number; // injected — no Date.now() here
  loginName: string;
  userVerified: boolean; // session.factors.passkey was user-verified
  mfaInitSkippedAt: string | null; // ISO or null (from neutral User)
  // nextMfaStep is by definition the MFA flow. The role is threaded explicitly so the
  // 'mfa' meaning of an `otp_email` second factor is pinned at the type boundary (a 'primary'
  // context is a compile error here) instead of inferred from a sentinel param. Behavior-neutral.
  context: Extract<FlowContext, { role: 'mfa' }>;
  requestId?: string;
  organization?: string;
  // When true, suppress ONLY the step-6 skippable MFA-setup nudge (return `done`
  // instead of `/setup/mfa?force=false`). Set on account-SWITCH, where re-firing the
  // enroll-now prompt is a regression. Steps 1–5 are unaffected: real challenges
  // (steps 1–4) and FORCED setup (step 5, settings.forceMfa) still route normally.
  suppressMfaSetupNudge?: boolean;
}

export type MfaRoutingResult =
  { kind: 'done' } | { kind: 'route'; path: string; params: Record<string, string> };

// Note: AuthMethod uses snake_case ('otp_email') while Factors keys use camelCase ('otpEmail') —
// separate concerns; do not conflate. The allow-list below intentionally excludes
// password/passkey/idp (and any future AuthMethod) from the 2nd-factor count.
// SecondFactorMethod is now the canonical type in modules/auth/types.ts (the other
// half of the otp_email dual-role). The runtime allow-list stays here (routing concern) and is
// pinned to that type via `satisfies` so the two can never drift; re-exported for back-compat.
export const SECOND_FACTOR_METHODS = [
  'totp',
  'otp_email',
  'otp_sms',
  'u2f',
] as const satisfies readonly SecondFactorMethod[];
export type { SecondFactorMethod };

export const USE_SCREEN: Record<SecondFactorMethod, string> = {
  totp: '/login/verify/authenticator',
  otp_email: '/login/verify/email',
  otp_sms: '/login/verify/sms',
  u2f: '/login/security-key',
};

/**
 * Intersect the user's enrolled second factors with the org login policy's allowed
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
  // Gate by the org login policy's allowed second factors (shared helper — see
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
  // forceMfa forces MFA for everyone; forceMfaLocalOnly forces it only for local
  // (username/password) logins and exempts sessions authenticated via an external IdP
  // (idpIntent factor present). Collapsing the two would wrongly force MFA on exempt IdP sessions.
  const idpAuthenticated = Boolean(factors.idpIntent?.verifiedAt);
  const mfaForced = settings.forceMfa || (Boolean(settings.forceMfaLocalOnly) && !idpAuthenticated);
  if (mfaForced) {
    return {
      kind: 'route',
      path: '/setup/mfa',
      params: { ...baseParams(input), force: 'true', checkAfter: 'true' },
    };
  }

  // 6. Skippable setup prompt, gated by the skip lifetime.
  // On account-switch the caller suppresses this nudge — switching to an
  // already-signed-in account must NOT re-fire the enroll-now prompt. Forced setup
  // (step 5 above) and real challenges (steps 1–4) have already been handled, so this
  // early `done` only skips the optional nudge, never a real requirement.
  if (input.suppressMfaSetupNudge) {
    return { kind: 'done' };
  }
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
