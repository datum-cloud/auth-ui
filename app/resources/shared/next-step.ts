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

export function nextStep(input: NextStepInput): string {
  const { factors, settings } = input;
  const nowMs = input.nowMs ?? 0;

  // Primary factor must be present and fresh.
  if (!primaryFresh(factors, nowMs, settings.passwordCheckLifetimeMs)) return '/login/password';

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
