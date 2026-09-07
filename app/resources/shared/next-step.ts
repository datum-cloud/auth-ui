import { primaryFresh } from './lifetimes';
import type { AuthMethod, Factors, LoginSettings } from '@/modules/auth/types';
import { nextMfaStep } from '@/resources/mfa/mfa-routing';

// nowMs is injected (never Date.now() inside flows/) so the lifetime-expiry
// branch stays deterministic.
export interface NextStepInput {
  factors: Factors;
  settings: LoginSettings;
  nowMs?: number;
  enrolledMethods?: AuthMethod[];
  loginName?: string;
  userVerified?: boolean;
  mfaInitSkippedAt?: string | null;
  requestId?: string;
  organization?: string;
  // Threaded from account-switch to suppress ONLY the step-6 skippable
  // MFA-setup nudge. Real challenges + forced setup are unaffected.
  suppressMfaSetupNudge?: boolean;
}

/**
 * Where to re-prompt a subject whose primary factor is missing or stale.
 *
 * NOT unconditionally '/login/password' — a dead end for anyone without one, and passwordless
 * accounts reach here routinely (an email-link session carries only `otpEmail`, which
 * `primaryFresh` does not count). Adding otpEmail to `primaryFresh` would close that in one line,
 * but `secondFactorFresh` already counts it, so one email code would satisfy both factors.
 *
 * Unknown enrolment keeps '/login/password', so existing callers are unaffected and a GHOST
 * subject still lands there — preserving `ignoreUnknownUsernames` indistinguishability.
 */
function repromptPrimaryPath(enrolledMethods: AuthMethod[] | undefined): string {
  if (!enrolledMethods?.length) return '/login/password';
  if (enrolledMethods.includes('password')) return '/login/password';
  if (enrolledMethods.includes('passkey')) return '/login/passkey';
  // Neither password nor passkey (e.g. otp_email- or idp-only): the chooser resolves what is
  // actually usable rather than guessing a single screen from here.
  return '/login/method';
}

export function nextStep(input: NextStepInput): string {
  const { factors, settings } = input;
  const nowMs = input.nowMs ?? 0;

  // Primary factor must be present and fresh; otherwise re-prompt for one the subject HAS.
  if (!primaryFresh(factors, nowMs, settings.passwordCheckLifetimeMs)) {
    return repromptPrimaryPath(input.enrolledMethods);
  }

  // Delegate the MFA decision to the pure engine.
  const mfa = nextMfaStep({
    factors,
    enrolledMethods: input.enrolledMethods ?? [],
    settings,
    nowMs,
    loginName: input.loginName ?? '',
    userVerified: input.userVerified ?? false,
    mfaInitSkippedAt: input.mfaInitSkippedAt ?? null,
    context: { role: 'mfa' }, // nextMfaStep is the mfa flow
    requestId: input.requestId,
    organization: input.organization,
    suppressMfaSetupNudge: input.suppressMfaSetupNudge,
  });

  if (mfa.kind === 'done') return '/signed-in';

  // nextStep owns MFA-routing params (force/checkAfter); ceremony params
  // (loginName/requestId/organization) are normally appended by nextStepWithParams, but a
  // DIRECT caller of nextStep must not silently lose them. So: start from the MFA params,
  // then add back any ceremony param that was passed into nextStep. The bridge passing them
  // again is idempotent (URLSearchParams.set overwrites).
  const params: Record<string, string> = { ...mfa.params };
  delete params.loginName;
  delete params.requestId;
  delete params.organization;
  if (input.loginName) params.loginName = input.loginName;
  if (input.requestId) params.requestId = input.requestId;
  if (input.organization) params.organization = input.organization;
  const mfaQs = new URLSearchParams(params).toString();
  return mfaQs ? `${mfa.path}?${mfaQs}` : mfa.path;
}
