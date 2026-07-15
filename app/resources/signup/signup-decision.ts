import type { Decision } from '@/resources/login/login-decision';
import { placeholderNameFromEmail } from '@/resources/signup/placeholder-name';

// The pure signup branch logic lifted out of routes/signup/index.tsx. The /signup
// identifier screen makes two routing decisions; each returns the shared Decision union
// (`{ kind: 'redirect' | 'error' }`) — consumers `switch (d.kind)`. No stringly targets, no HTTP.
// Mirrors login-decision.ts; reuses its Decision type so the union stays single-sourced.

// Mirror of login.service.ts StartIdpResult (kept structural to avoid a server-module import
// from a pure decider): { ok:true, authUrl } | { ok:false, error }.
export type SignupIdpIntentResult = { ok: true; authUrl: string } | { ok: false; error: string };

/**
 * IdP-button branch: a startIdpIntent result becomes either a redirect to the provider's
 * authUrl (already an absolute external URL — passed through verbatim) or a surfaced error.
 */
export function decideSignupIdpIntent(result: SignupIdpIntentResult): Decision {
  if (result.ok) return { kind: 'redirect', path: result.authUrl };
  return { kind: 'error', error: result.error };
}

export interface AfterSignupIdentifierInput {
  email: string;
  organization?: string;
  requestId?: string;
  deviceTrackingToken?: string;
}

/**
 * Email-identifier branch: derive the duplicated placeholder name from the email (so the
 * complete-profile flow fires downstream — see placeholderNameFromEmail) and route to
 * /signup/method, threading the optional context as typed params. Absent context keys are
 * omitted entirely (never emitted as empty strings) so the route's paths.signup.method(params)
 * produces the same querystring the hand-built URLSearchParams did.
 */
export function decideAfterSignupIdentifier({
  email,
  organization,
  requestId,
  deviceTrackingToken,
}: AfterSignupIdentifierInput): Decision {
  const { firstName, lastName } = placeholderNameFromEmail(email);
  const params: Record<string, string> = { loginName: email, firstName, lastName };
  if (organization) params.organization = organization;
  if (requestId) params.requestId = requestId;
  if (deviceTrackingToken) params.deviceTrackingToken = deviceTrackingToken;
  return { kind: 'redirect', path: '/signup/method', params };
}
