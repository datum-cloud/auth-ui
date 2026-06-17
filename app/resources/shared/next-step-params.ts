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
    nowMs: Date.now(),
  });

  const params = new URLSearchParams();
  if (input.loginName) params.set('loginName', input.loginName);
  // CODE-MIN-13: only thread a requestId that matches the Zitadel-issued prefix allowlist
  // (oidc_/saml_/device_). A malformed value is treated as absent rather than reflected.
  if (input.requestId && REQUEST_ID_PATTERN.test(input.requestId)) {
    params.set('requestId', input.requestId);
  }
  if (input.organization) params.set('organization', input.organization);
  const qs = params.toString();
  if (!qs) return target;

  // target may already contain MFA-specific params (e.g. force=true&checkAfter=true)
  // from nextStep; append ceremony params with & rather than ?.
  const sep = target.includes('?') ? '&' : '?';
  return `${target}${sep}${qs}`;
}
