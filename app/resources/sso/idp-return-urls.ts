// Build the success/failure return URLs handed to the provider when starting an external
// IdP intent (e.g. "Continue with Google").
//
// CRITICAL: these are ABSOLUTE URLs the IdP broker (Zitadel) redirects the browser to
// DIRECTLY after the IdP round-trip. React Router's basename auto-prefix does NOT apply to
// them (unlike `redirect('/sso/…')` from a loader/action). The app is served under the `/id`
// basename (see react-router.config.ts `basename: '/id/'`), so the basename MUST be included
// explicitly — omitting it sends the IdP callback to `/sso/<provider>/callback`, which 404s
// because the route actually lives at `/id/sso/<provider>/callback`.
//
// The original OIDC/SAML `requestId` MUST ride on the success URL too: the IdP broker appends
// `&id=…&token=…` and redirects there, and the SSO callback uses `requestId` to forward back
// to `/authorize` (and finish the protocol). Without it the callback dead-ends at /signed-in.
// APP_BASENAME is defined once in resources/shared; re-exported here for back-compat
// (the sso barrel and this module's URL builder both consume it).
import { APP_BASENAME } from '@/resources/shared/app-basename';
import { signParam } from '@/server/signed-param';

export { APP_BASENAME };

/**
 * HMAC purpose tag for `policyOrg`. Shared with the callback that verifies it — a mismatch here
 * is a fail-closed (the callback falls back to `organization`), never an accepted forgery.
 */
export const POLICY_ORG_PURPOSE = 'sso.policyOrg';

export interface IdpReturnOpts {
  /** Original OIDC/SAML request to resume after the IdP round-trip (e.g. `oidc_…`). */
  requestId?: string;
  /** Org scope to carry through the ceremony. */
  organization?: string;
  /**
   * The POLICY org this intent was decided under, when it differs from the ceremony
   * `organization` (which is the RAW `?organization=` the user arrived with, often absent).
   *
   * The callback resolves the org it reads `allowRegister` from — and auto-creates into — from
   * `organization`, which on a bare flow falls back to the DEFAULT org. A caller that picked
   * this IdP out of a list resolved for a DIFFERENT org (e.g. /login/method resolving the found
   * user's own org) would otherwise have its start decided under one policy and its landing
   * decided under another. Carrying it separately fixes that divergence WITHOUT widening
   * `organization`, whose absence is what keeps the callback's `findUser` lookups instance-wide
   * (see the note at sso-callback.ts's `callbackOrg`).
   */
  policyOrg?: string;
  /** Account-linking flow (sets `?link=true` for the callback). */
  link?: boolean;
  /**
   * MaxMind device-fingerprint token captured client-side, forwarded through the OAuth
   * round-trip so it can be attached to the resulting session's metadata.
   */
  deviceTrackingToken?: string;
}

/**
 * @param origin scheme + host (e.g. `http://localhost:3000`) — no path/basename.
 * @param slug   IdP provider segment for the `/sso/:provider/...` route.
 */
export function idpReturnUrls(
  origin: string,
  slug: string,
  opts?: IdpReturnOpts
): { success: string; failure: string } {
  const base = `${origin}${APP_BASENAME}/sso/${encodeURIComponent(slug)}`;
  const query = new URLSearchParams();
  if (opts?.link) query.set('link', 'true');
  if (opts?.requestId) query.set('requestId', opts.requestId);
  if (opts?.organization) query.set('organization', opts.organization);
  // Only when it actually differs — an identical value would be pure URL noise, and omitting it
  // keeps every existing caller's success URL byte-identical.
  //
  // SIGNED, because this param is the one thing on the URL that is NOT already coupled to
  // something else. `organization` drags the callback's same-email findUser scope, the created
  // session's orgId and signInWithIdpIntent along with it, so naming a foreign org there costs an
  // attacker the whole flow (an accidental fail-closed). `policyOrg` drags nothing: it feeds
  // `callbackOrg` alone, which is what gates `allowRegister` and picks the auto-create org. A
  // hand-written `?policyOrg=<some-org-with-registration-open>` would therefore borrow that org's
  // registration policy while leaving the same-email lookup instance-wide — with
  // ALLOW_IDP_AUTO_LINK on, a path into a victim's account in ANY org. Length validation cannot
  // help: decoupling those two orgs is the param's whole purpose, so only provenance can.
  if (opts?.policyOrg && opts.policyOrg !== opts.organization) {
    query.set('policyOrg', opts.policyOrg);
    query.set('policyOrgSig', signParam(POLICY_ORG_PURPOSE, opts.policyOrg));
  }
  if (opts?.deviceTrackingToken) query.set('deviceTrackingToken', opts.deviceTrackingToken);
  const qs = query.toString();
  // The failure URL MUST carry requestId/organization too — the IdP broker redirects here
  // DIRECTLY on a failed round-trip, and sso/provider/error.tsx needs them to route "Back to
  // sign in" back into the live ceremony instead of dropping it (regression: dead-end on IdP
  // failure). Only requestId/organization are relevant here (link/deviceTrackingToken are
  // success-path-only concerns).
  const failureQuery = new URLSearchParams();
  if (opts?.requestId) failureQuery.set('requestId', opts.requestId);
  if (opts?.organization) failureQuery.set('organization', opts.organization);
  const failureQs = failureQuery.toString();
  return {
    success: `${base}/callback${qs ? `?${qs}` : ''}`,
    failure: `${base}/error${failureQs ? `?${failureQs}` : ''}`,
  };
}
