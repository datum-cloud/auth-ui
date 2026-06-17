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
export const APP_BASENAME = '/id';

export interface IdpReturnOpts {
  /** Original OIDC/SAML request to resume after the IdP round-trip (e.g. `oidc_…`). */
  requestId?: string;
  /** Org scope to carry through the ceremony. */
  organization?: string;
  /** Account-linking flow (sets `?link=true` for the callback). */
  link?: boolean;
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
  const base = `${origin}${APP_BASENAME}/sso/${slug}`;
  const query = new URLSearchParams();
  if (opts?.link) query.set('link', 'true');
  if (opts?.requestId) query.set('requestId', opts.requestId);
  if (opts?.organization) query.set('organization', opts.organization);
  const qs = query.toString();
  return {
    success: `${base}/callback${qs ? `?${qs}` : ''}`,
    failure: `${base}/error`,
  };
}
