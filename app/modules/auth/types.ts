export type AuthMethod = 'password' | 'passkey' | 'idp' | 'totp' | 'otp_email' | 'otp_sms' | 'u2f';

export interface BrandingTheme {
  logoUrl?: string;
  darkLogoUrl?: string;
  primaryColor?: string;
  backgroundColor?: string;
  fontUrl?: string;
  hideLoginNameSuffix?: boolean;
}

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
  verifiedAt: string | null; // ISO timestamp; '' is NOT valid — mappers must normalize empty → null (flows treat '' as unverified)
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
  mfaInitSkippedAt?: string | null; // BLK-06 — last forced-MFA-setup skip (ISO timestamp); written via setMfaInitSkipped  // P5
}

export interface SessionChallenges {
  webAuthN?: {
    publicKeyCredentialRequestOptions?: unknown; // assertion (login)
    publicKeyCredentialCreationOptions?: unknown; // attestation (register)
  };
  otpEmail?: unknown;
  /** Present when the otpEmail challenge was requested with { returnCode: true }; carries the OTP code returned server-side instead of emailing it. */
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
  forceMfa: boolean;
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
  mfaInitSkipLifetimeMs?: number; // BLK-06 — skip window (adapter converts Duration→Ms)  // P5
  /** Zitadel login policy default redirect URI (settings.v2). Empty/unset → undefined. */
  defaultRedirectUri?: string;
  /**
   * Policy-allowed second-factor methods from the login policy (proto `secondFactors`).
   * Bug C: routing/setup intersect enrolled methods with this when present & non-empty.
   * `undefined` (fake/older settings) → no restriction (enrolled-only, back-compat).
   * Note: this is a DIFFERENT enum from the per-user enrolled AuthMethod list — it reflects
   * which TYPES the org policy enables, not what the user has enrolled.
   */
  secondFactors?: AuthMethod[];
  /**
   * Policy-allowed multi-factor methods (proto `multiFactors`, e.g. U2F-with-verification → passkey).
   * Bug C: gates the passkey row in the setup chooser. `undefined` → no restriction (back-compat).
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
