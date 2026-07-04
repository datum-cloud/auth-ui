export type AuthMethod = 'password' | 'passkey' | 'idp' | 'totp' | 'otp_email' | 'otp_sms' | 'u2f';

/**
 * The two role-scoped projections of `AuthMethod`. `otp_email` lives in BOTH
 * deliberately — it is a first-class PRIMARY sign-in method (decideAfterIdentifier) AND a
 * second factor (nextMfaStep). The role decides which screen a given `otp_email` routes to
 * (/login/verify/email is shared, but the surrounding flow differs), so it must be expressed
 * structurally rather than inferred from a sentinel query param.
 */
export type PrimaryAuthMethod = 'password' | 'passkey' | 'idp' | 'otp_email';
export type SecondFactorMethod = 'totp' | 'otp_email' | 'otp_sms' | 'u2f';

/**
 * The flow a routing/decision call is running inside, threaded explicitly so call sites
 * pass a typed role instead of inferring 'primary' vs 'mfa' from sentinel query params.
 * Behavior-neutral: `decideAfterIdentifier` is always `{ role: 'primary' }` and `nextMfaStep`
 * is always `{ role: 'mfa' }` — the discriminant pins the role at the type boundary (a primary
 * decision can never be fed an mfa context, and vice versa) without changing any target.
 */
export type FlowContext = { role: 'primary' } | { role: 'mfa' };

export interface BrandingTheme {
  logoUrl?: string;
  darkLogoUrl?: string;
  primaryColor?: string;
  backgroundColor?: string;
  fontUrl?: string;
  hideLoginNameSuffix?: boolean;
}

/**
 * The coerced password-complexity policy (mirror of `toPasswordComplexity`'s return).
 * `getPasswordComplexity` returns `this | undefined` — undefined when the provider omits the
 * settings block. minLength is coerced from the proto uint64 (bigint) to a JSON-safe number.
 */
export interface PasswordComplexity {
  minLength: number;
  requiresUppercase: boolean;
  requiresLowercase: boolean;
  requiresNumber: boolean;
  requiresSymbol: boolean;
}

/**
 * The neutral attestation-challenge struct returned by `registerPasskey` / `registerU2F`.
 * `publicKey*CreationOptions` is the raw WebAuthn `publicKey` envelope (a `PublicKeyCredentialCreationOptions`
 * JSON object); routes treat its inner value as opaque (`unknown`) and pass it to the browser
 * WebAuthn API. The named struct removes the unsound `as { ... }` cast at the service boundary.
 */
export interface WebAuthnCreationOptions {
  passkeyId: string;
  publicKeyCredentialCreationOptions: { publicKey: unknown };
}

/** U2F (security-key) analogue of `WebAuthnCreationOptions` (the id field is `u2fId`). */
export interface U2FCreationOptions {
  u2fId: string;
  publicKeyCredentialCreationOptions: { publicKey: unknown };
}

/**
 * The email-OTP challenge request, as a discriminated union on `kind`.
 *   'send'          → request the code with the provider's DEFAULT emailed link.
 *   'send-template' → request the code, overriding the emailed link with `urlTemplate` (built by
 *                     flows/otp-email-url-template.ts) so it lands on OUR /id/login/verify/email
 *                     route instead of the provider's /ui/v2/login/otp/email page.
 *   'return-code'   → the code is NOT emailed; it is returned on the session under
 *                     `SessionChallenges.otpEmailCode` so callers can complete the factor in-band.
 */
export type OtpEmailChallenge =
  { kind: 'send' } | { kind: 'send-template'; urlTemplate: string } | { kind: 'return-code' };

// OIDC (Phase 1) — SAML fields added in Phase 5.
export interface AuthRequest {
  id: string;
  clientId?: string;
  scopes: string[];
  prompt: ('login' | 'select_account' | 'create' | 'none' | 'consent')[];
  loginHint?: string;
  redirectUri?: string;
}

export interface FactorState {
  // A Date is never falsy/empty — mappers normalize an absent/malformed proto
  // Timestamp to `null` (flows treat null as unverified). This eliminates the prior
  // `string | null` where the empty string '' was a structurally-valid-but-semantically
  // invalid third state the freshness check had to defend against.
  verifiedAt: Date | null;
  userVerified?: boolean; // from the webauthn factor; drives the passwordless-passkey MFA-satisfied rule  // P4
}
export interface Factors {
  password?: FactorState;
  passkey?: FactorState;
  idpIntent?: FactorState;
  totp?: FactorState;
  otpEmail?: FactorState;
  otpSms?: FactorState;
  u2f?: FactorState;
}
export interface User {
  id: string;
  loginName: string;
  displayName?: string;
  orgId?: string;
  mfaInitSkippedAt?: string | null; // last forced-MFA-setup skip (ISO timestamp); written via setMfaInitSkipped  // P5
}

export interface SessionChallenges {
  webAuthN?: {
    publicKeyCredentialRequestOptions?: unknown; // assertion (login)
    publicKeyCredentialCreationOptions?: unknown; // attestation (register)
  };
  // The redundant `otpEmail?: unknown` was removed. The proto otpEmail field is
  // only ever the returned OTP code (returnCode delivery), which is surfaced through the
  // typed `otpEmailCode` below — no caller read the untyped `otpEmail` duplicate.
  /** Present when the otpEmail challenge was requested with `{ kind: 'return-code' }`; carries the OTP code returned server-side instead of emailing it. */
  otpEmailCode?: string;
  otpSms?: unknown;
}
export interface Session {
  id: string;
  token: string;
  user?: User;
  factors: Factors;
  expiresAt: string;
  changedAt: string;
  challenges?: SessionChallenges; // populated by updateSession when checks request a webauthn/otp challenge  // P4
}

export interface LoginSettings {
  allowPassword: boolean;
  allowRegister: boolean;
  allowExternalIdp: boolean;
  passkeysType: 'not_allowed' | 'allowed';
  /** Login policy: MFA is mandatory for all sessions (local and IdP). Proto `forceMfa`. */
  forceMfa: boolean;
  /**
   * Login policy: MFA is mandatory only for local (username/password) logins; sessions
   * authenticated via an external IdP are exempt. Proto `forceMfaLocalOnly`. Optional,
   * default-off. Kept distinct from `forceMfa` so IdP sessions the policy exempts are not
   * wrongly forced into MFA setup.
   */
  forceMfaLocalOnly?: boolean;
  /** Login policy: hide the "Forgot password?" entry point. Proto `hidePasswordReset`. Optional (undefined ⇒ show). */
  hidePasswordReset?: boolean;
  /**
   * Login policy: when an entered identifier matches no known user, proceed to the
   * password step anyway (anti-enumeration) instead of surfacing USER_NOT_FOUND.
   * Proto `ignoreUnknownUsernames`. Optional, default-off (undefined/false ⇒ today's behavior).
   */
  ignoreUnknownUsernames?: boolean;
  /** Domain policy: email cannot be used as a login identifier. Proto `disableLoginWithEmail`. Optional, default-off. */
  disableLoginWithEmail?: boolean;
  /** Domain policy: phone cannot be used as a login identifier. Proto `disableLoginWithPhone`. Optional, default-off. */
  disableLoginWithPhone?: boolean;
  /** Login policy: email domain → org/IdP routing. Proto allowDomainDiscovery. Optional, default-off. */
  allowDomainDiscovery?: boolean;
  passwordCheckLifetimeMs?: number;
  secondFactorCheckLifetimeMs?: number;
  multiFactorCheckLifetimeMs?: number;
  mfaInitSkipLifetimeMs?: number; // skip window (adapter converts Duration→Ms)  // P5
  /** Zitadel login policy default redirect URI (settings.v2). Empty/unset → undefined. */
  defaultRedirectUri?: string;
  /**
   * Policy-allowed second-factor methods from the login policy (proto `secondFactors`).
   * Routing/setup intersect enrolled methods with this when present & non-empty.
   * `undefined` (fake/older settings) → no restriction (enrolled-only, back-compat).
   * Note: this is a DIFFERENT enum from the per-user enrolled AuthMethod list — it reflects
   * which TYPES the org policy enables, not what the user has enrolled.
   */
  secondFactors?: AuthMethod[];
  /**
   * Policy-allowed multi-factor methods (proto `multiFactors`, e.g. U2F-with-verification → passkey).
   * Gates the passkey row in the setup chooser. `undefined` → no restriction (back-compat).
   */
  multiFactors?: AuthMethod[];
}
export interface IdProvider {
  id: string;
  name: string;
  type: string;
  logoUrl?: string;
}

export type ProviderErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_CREDENTIALS'
  | 'MFA_REQUIRED'
  | 'RATE_LIMITED'
  | 'PERMISSION_DENIED'
  | 'UNAVAILABLE'
  | 'DEADLINE_EXCEEDED'
  | 'PASSWORD_EXPIRED'
  | 'ALREADY_DONE'
  | 'PASSWORD_COMPLEXITY'
  | 'ALREADY_EXISTS'
  | 'FAILED_PRECONDITION'
  | 'UNKNOWN';
/** Runtime class — import as a value (`import { ProviderError }`), never `import type`, or `instanceof` checks fail silently. */
export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    public retriable = false,
    public detail?: { failedAttempts?: number; maxAttempts?: number }
  ) {
    super(message);
    this.name = 'ProviderError'; // subclass name isn't set automatically; keeps logs/Sentry grouping accurate
  }
}

// ── external IdP (Phase 4) ────────────────────────────────────
export interface IdpIntentRef {
  idpIntentId: string;
  idpIntentToken: string;
}

export interface IdpInformation {
  idpId: string;
  idpUserId: string; // the user id on the IdP side
  idpUserName: string;
  accessToken?: string; // present for GitHub (used to fetch hidden primary email)
}

export interface IdpLink {
  idpId: string;
  idpUserId: string;
  idpUserName: string;
}

export interface IdpUserDraft {
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  displayName?: string;
}

/** Result of retrieveIdpIntent, normalized. */
export interface IdpIntentResult {
  information: IdpInformation;
  userId: string | null; // present ⇒ Zitadel already maps this IdP identity to a Datum user
  draft: IdpUserDraft | null; // present ⇒ profile pre-built from IdP claims (for register-and-link)
}

export interface IdpStartResult {
  authUrl?: string;
  formData?: unknown;
} // formData = SAML (Phase 6)

export interface ProviderCapabilities {
  passkey: boolean;
  u2f: boolean;
  totpOtp: boolean;
  emailOtp: boolean;
  smsOtp: boolean;
  externalIdp: boolean;
  ldap: boolean;
  saml: boolean;
  oidc: boolean;
  registration: boolean;
}

// ── device grant (P6) ────────────────────────────────────
export interface DeviceAuthRequest {
  id: string; // deviceAuthorizationId
  appName?: string;
  scope: string[];
}

// ── saml (P6) ────────────────────────────────────────────
export type SamlBinding = 'redirect' | 'post';
/**
 * Deliberately flat-optional (not a discriminated union): the value arrives
 * from the provider transport, where static types cannot guarantee runtime
 * presence — `resolveSamlBinding` (flows/saml-binding) is the seam guard that
 * enforces the post-binding fields at runtime.
 */
export interface SamlResponse {
  url: string;
  binding: SamlBinding;
  relayState?: string; // present for post binding
  samlResponse?: string; // present for post binding
}

// ── ldap (P6) ────────────────────────────────────────────
export interface LdapIntent {
  userId: string; // Zitadel user id resolved from the LDAP credential exchange (not the idp-side IdpInformation.idpUserId); empty string ('') when the IdP user is unlinked (Zitadel issues a register-draft, not a sign-in)
  idpIntentId: string;
  idpIntentToken: string;
}
