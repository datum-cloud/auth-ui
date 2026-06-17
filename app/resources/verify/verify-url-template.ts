// PUBLIC_ORIGIN (the trusted origin passed as `origin`) is scheme+host ONLY, and the app is
// served under the /id/ basename. APP_BASENAME (single source of truth in resources/shared)
// MUST be in the email link or it resolves to the Zitadel API (which shares the origin) instead
// of our route.
import { APP_BASENAME } from '@/resources/shared/app-basename';

export interface VerifyUrlTemplateInput {
  /**
   * Trusted app origin — scheme + host (e.g. `https://auth.datum.net` or
   * `http://localhost:3000`). The template is absolute. This MUST come from
   * trusted config (PUBLIC_ORIGIN), NOT the request Host header — see
   * routes/_shared/app-origin.server.ts (trustedAppOrigin) for the resolver and
   * the security rationale (Host-header email-link injection).
   */
  origin: string;
  /**
   * App-relative path the email link lands on. Defaults to `/verify` (email
   * verification + invite). Pass `/password/new` for the password-reset email link —
   * both share the SAME trusted-origin + raw-brace contract, so they reuse this helper
   * rather than re-deriving the placeholder string (which must NOT be percent-encoded).
   */
  path?: string;
  /** Carried through so the post-verify step can resume an OIDC/SAML ceremony. */
  requestId?: string;
  /** When true, the verify route treats the code as an invite code (verifyInvite). */
  invite?: boolean;
}

/**
 * Builds the URL template passed to a provider email-sending call — `verifyUrlTemplate`
 * for `provider.register` (the `/verify` link) and the `urlTemplate` for
 * `provider.sendPasswordReset` (the `/password/new` link). The provider substitutes the
 * RAW placeholders {{.Code}}, {{.UserID}}, {{.OrgID}} when it sends the mail, so the link
 * lands on OUR route (`path`, default `/verify`) rather than the provider's built-in page.
 *
 * The braces MUST stay literal/unencoded — Zitadel does not URL-decode them
 * (verified live: `%7B%7B.Code%7D%7D` is left untouched in the sent mail), so we
 * cannot build this with URLSearchParams. Only the non-placeholder query values
 * (requestId) are URL-encoded.
 *
 * `origin` already includes the scheme (https:// or http://), so this function is
 * PURE and scheme-honest — it does NOT hardcode https. The caller is responsible
 * for supplying a TRUSTED origin (trustedAppOrigin), never the raw request Host.
 */
export function verifyUrlTemplate(input: VerifyUrlTemplateInput): string {
  const path = input.path ?? '/verify';
  const placeholders = `code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}`;
  const invite = input.invite ? `&invite=true` : '';
  const extra = input.requestId ? `&requestId=${encodeURIComponent(input.requestId)}` : '';
  return `${input.origin}${APP_BASENAME}${path}?${placeholders}${invite}${extra}`;
}
