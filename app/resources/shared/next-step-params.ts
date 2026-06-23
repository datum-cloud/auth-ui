import { REQUEST_ID_PATTERN } from '@/resources/schemas/request-id';
import { nextStep, type NextStepInput } from '@/resources/shared/next-step';

/**
 * Route-layer bridge: calls the pure `nextStep` engine and appends the threaded
 * query params (loginName, requestId, organization) so every verify/setup action
 * redirects with the ceremony context intact.
 *
 * `Date.now()` lives here, NOT inside `flows/next-step` (flows must stay pure /
 * deterministic for unit testing without clock injection).
 */
export interface NextStepParams {
  factors: NextStepInput['factors'];
  settings: NextStepInput['settings'];
  enrolledMethods?: NextStepInput['enrolledMethods'];
  loginName?: string;
  userVerified?: boolean;
  mfaInitSkippedAt?: string | null;
  requestId?: string;
  organization?: string;
  // 755-M10: forwarded to nextStep → nextMfaStep to suppress ONLY the step-6 skippable
  // MFA-setup nudge on account-switch. Forced setup + real challenges are unaffected.
  suppressMfaSetupNudge?: boolean;
}

export function nextStepWithParams(input: NextStepParams): string {
  const target = nextStep({
    factors: input.factors,
    settings: input.settings,
    enrolledMethods: input.enrolledMethods,
    loginName: input.loginName,
    userVerified: input.userVerified,
    mfaInitSkippedAt: input.mfaInitSkippedAt,
    requestId: input.requestId,
    organization: input.organization,
    suppressMfaSetupNudge: input.suppressMfaSetupNudge,
    nowMs: Date.now(),
  });

  // nextStep ALREADY bakes the ceremony params (loginName/requestId/organization) into the
  // target's query — so we must MERGE into that existing query (set() dedupes), not blindly
  // append with `&`, which produced a duplicated `loginName=…&loginName=…` (F3). Splitting on
  // the first '?' preserves any MFA-specific params (force/checkAfter) nextStep already set.
  const qIndex = target.indexOf('?');
  const base = qIndex === -1 ? target : target.slice(0, qIndex);
  const params = new URLSearchParams(qIndex === -1 ? '' : target.slice(qIndex + 1));

  if (input.loginName) params.set('loginName', input.loginName);
  // Only thread a requestId that matches the Zitadel-issued prefix allowlist
  // (oidc_/saml_/device_). A malformed value is treated as absent rather than reflected
  // (and dropped from any value nextStep may have already set).
  if (input.requestId && REQUEST_ID_PATTERN.test(input.requestId)) {
    params.set('requestId', input.requestId);
  } else {
    params.delete('requestId');
  }
  if (input.organization) params.set('organization', input.organization);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
