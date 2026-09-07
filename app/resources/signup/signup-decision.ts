import type { Decision } from '@/resources/login/login-decision';

// The pure signup branch logic lifted out of routes/signup/index.tsx. The /signup
// identifier screen makes ONE routing decision now; it returns the shared Decision union
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
