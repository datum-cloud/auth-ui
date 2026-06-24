import type { AuthMethod, LoginSettings, Session } from '@/modules/auth/types';
import { REQUEST_ID_PATTERN } from '@/resources/schemas/request-id';
import { nextStep, type NextStepInput } from '@/resources/shared/next-step';

/**
 * Unconditional ceremony-context query threader: loginName is always present;
 * requestId/organization only when truthy. Returns the encoded query string the
 * caller appends to a target path. This is the SIMPLE builder (no REQUEST_ID_PATTERN
 * validation) — use `nextStepWithParams` when the validating variant is required.
 */
export function threadParams(loginName: string, requestId?: string, organization?: string): string {
  const params = new URLSearchParams({ loginName });
  if (requestId) params.set('requestId', requestId);
  if (organization) params.set('organization', organization);
  return params.toString();
}

/**
 * Post-callback hand-back target: when a ceremony requestId is present, route back
 * into /authorize with the explicit sessionId (mirrors the password path's hand-back);
 * otherwise the terminal /signed-in. Encode-only — these sites intentionally do NOT
 * run REQUEST_ID_PATTERN validation.
 */
export function authorizeHandbackTarget(requestId: string | undefined, sessionId: string): string {
  return requestId
    ? `/authorize?requestId=${encodeURIComponent(requestId)}&sessionId=${encodeURIComponent(sessionId)}`
    : '/signed-in';
}

/**
 * The branded SSO error redirect location: /sso/<slug>/error?reason=<reason>. Both
 * segments are URL-encoded. Callers pass the already-mapped reason (e.g. via
 * providerErrorCode); the special-case idp.link ALREADY_EXISTS block stays bespoke.
 */
export function ssoErrorRedirect(slug: string, reason: string): string {
  return `/sso/${encodeURIComponent(slug)}/error?reason=${encodeURIComponent(reason)}`;
}

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
  // Forwarded to nextStep → nextMfaStep to suppress ONLY the step-6 skippable
  // MFA-setup nudge on account-switch. Forced setup + real challenges are unaffected.
  suppressMfaSetupNudge?: boolean;
}

/**
 * Derive the post-ceremony next step from a resolved provider `session`.
 *
 * This centralises ONLY the truly-shared assembly: pulling `factors` off the session,
 * deriving `userVerified` from the passkey factor, and calling `nextStepWithParams`.
 * The two genuinely-divergent inputs are passed in by each caller as ALREADY-RESOLVED
 * values, never re-derived here — this is deliberate (the divergences are subtle and
 * folding them in would silently change behavior):
 *
 *   - `loginName`: webauthn/mfa resolve `session.user?.loginName ?? loginName`; the
 *     password login path passes the RAW typed loginName (it must NOT defer to the
 *     session user). The caller decides; the helper just forwards it.
 *   - `mfaInitSkippedAt`: the mfa-skip path passes the FRESH re-fetched user's value
 *     (the session.user copy is stale right after stamping the skip); other callers pass
 *     `session.user?.mfaInitSkippedAt`. The caller decides; the helper just forwards it.
 *
 * `suppressMfaSetupNudge` and the allowlisted-requestId override (account-switch) are
 * NOT session-derived and stay bespoke in session.service — they do not use this helper.
 */
export interface NextStepFromSessionInput {
  session: Session;
  methods: AuthMethod[];
  settings: LoginSettings;
  /** Final resolved loginName (see note above — caller resolves the divergence). */
  loginName: string;
  /** Final resolved mfaInitSkippedAt (see note above — caller resolves the divergence). */
  mfaInitSkippedAt: string | null | undefined;
  requestId?: string;
  organization?: string;
}

export function nextStepFromSession(input: NextStepFromSessionInput): string {
  return nextStepWithParams({
    factors: input.session.factors,
    settings: input.settings,
    enrolledMethods: input.methods,
    loginName: input.loginName,
    userVerified: input.session.factors.passkey?.userVerified ?? false,
    mfaInitSkippedAt: input.mfaInitSkippedAt,
    requestId: input.requestId,
    organization: input.organization,
  });
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
  // append with `&`, which produced a duplicated `loginName=…&loginName=…`. Splitting on
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
