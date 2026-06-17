export interface OtpEmailUrlTemplateInput {
  /**
   * Trusted app origin — scheme + host (e.g. `https://auth.datum.net` or
   * `http://localhost:3000`). MUST come from trusted config (PUBLIC_ORIGIN) via
   * routes/_shared/app-origin.server.ts (trustedAppOrigin), NEVER the request Host
   * header — see verify-url-template.ts for the Host-header email-link-injection rationale.
   *
   * NOTE: trustedAppOrigin returns ORIGIN-ONLY (no path), and the app is served under the
   * `/id/` basename, so this helper appends the explicit `/id/login/verify/email` path.
   */
  origin: string;
  /**
   * The user's loginName, threaded so the verify route can re-resolve the session entry.
   * This is a REAL value (URL-encoded), NOT a provider placeholder — unlike {{.Code}} etc.
   */
  loginName: string;
  /** Carried through so the post-verify step can resume an OIDC/SAML ceremony. */
  requestId?: string;
  /** Carried through so the verify route can disambiguate a multi-org session entry. */
  organization?: string;
}

/**
 * Builds the OTPEmail `url_template` passed to the challenge-request seam
 * (SessionChecks.challenges.otpEmail.urlTemplate → proto OTPEmail.SendCode.url_template).
 * Zitadel substitutes the RAW placeholders {{.Code}}, {{.UserID}}, {{.SessionID}} when it
 * sends the email-OTP mail, so the link lands on OUR /id/login/verify/email route instead
 * of the provider's default /ui/v2/login/otp/email page.
 *
 * The braces MUST stay literal/unencoded — Zitadel does not URL-decode them (verified live
 * for the register/verify path), so this cannot be built with URLSearchParams. Only the real
 * (non-placeholder) values — loginName, requestId, organization — are URL-encoded.
 *
 * OTPEmail supports a DIFFERENT placeholder set than the register/verify email template:
 * {{.Code}} {{.UserID}} {{.LoginName}} {{.DisplayName}} {{.PreferredLanguage}} {{.SessionID}}
 * — notably it does NOT support {{.OrgID}}, so we never emit it here (we encode `organization`
 * as a real query value when supplied instead).
 *
 * `origin` already includes the scheme, so this function is PURE and scheme-honest — it does
 * NOT hardcode https. The caller supplies a TRUSTED origin (trustedAppOrigin), never the Host.
 */
export function otpEmailUrlTemplate(input: OtpEmailUrlTemplateInput): string {
  // Query-param NAMES are the contract with the verify route, which reads them by name (not
  // position) via url.searchParams.get(...) in routes/login.verify.email.tsx — keep these names
  // in sync with that loader. `code`/`userId`/`sessionId` are RAW Zitadel placeholders the
  // provider substitutes ({{.Code}} {{.UserID}} {{.SessionID}}); the rest are real values below.
  const placeholders = `code={{.Code}}&userId={{.UserID}}&sessionId={{.SessionID}}`;
  const loginName = `&loginName=${encodeURIComponent(input.loginName)}`;
  const requestId = input.requestId ? `&requestId=${encodeURIComponent(input.requestId)}` : '';
  const organization = input.organization
    ? `&organization=${encodeURIComponent(input.organization)}`
    : '';
  return `${input.origin}/id/login/verify/email?${placeholders}${loginName}${requestId}${organization}`;
}
