import type {
  LoginSettings,
  BrandingTheme,
  Session,
  User,
  AuthMethod,
  AuthRequest,
  DeviceAuthRequest,
  IdpIntentResult,
  IdpLink,
  LdapIntent,
  OtpEmailChallenge,
  PasswordComplexity,
  ProviderCapabilities,
  IdProvider,
  SamlResponse,
  U2FCreationOptions,
  WebAuthnCreationOptions,
} from './types';

// Phase 0 surface: a documented password-only subset of the canonical INDEX §A
// SessionChecks shape, grown per phase as later factors land.
export interface SessionChecks {
  password?: string;
  webAuthN?: { credentialAssertionData: unknown };
  totp?: string;
  otpEmail?: string;
  otpSms?: string;
  idpIntent?: { idpIntentId: string; idpIntentToken: string };
  /**
   * P5 — request a challenge; the result rides back on the returned Session.challenges.
   * webAuthN.userVerificationRequirement:
   *   'required'    = passwordless passkey context (USER_VERIFICATION_REQUIREMENT_REQUIRED)
   *   'discouraged' = 2nd-factor U2F context       (USER_VERIFICATION_REQUIREMENT_DISCOURAGED)
   */
  challenges?: {
    webAuthN?: { domain: string; userVerificationRequirement: 'required' | 'discouraged' };
    /**
     * The email-OTP challenge as a discriminated union (see `OtpEmailChallenge`).
     *   { kind: 'send' }                        → provider default emailed link.
     *   { kind: 'send-template'; urlTemplate }  → override the emailed link with OUR /verify route.
     *   { kind: 'return-code' }                 → code returned in-band on Session.challenges.otpEmailCode.
     * The mapper (`toChallengeRequest`) switches on `kind` to build proto OTPEmail delivery.
     */
    otpEmail?: OtpEmailChallenge;
    otpSms?: boolean;
  };
}
export interface SessionOpts {
  orgId?: string;
  requestId?: string;
  /**
   * Control hint: the user the session is being created for. Used to build the
   * Zitadel user-selection check (checks.user.search.userId). NOT forwarded to
   * Zitadel as session metadata.
   */
  userId?: string;
  /**
   * REAL Zitadel session metadata — forwarded to the CreateSession proto
   * `metadata` map (map<string, bytes>; string values are TextEncoder-encoded to
   * bytes by the adapter). Used to carry the MaxMind device-tracking token under
   * the key 'maxmind/tracking-token'.
   */
  metadata?: Record<string, string>;
  /**
   * Device/browser context — forwarded to the Zitadel CreateSession proto
   * `userAgent` field (zitadel.session.v2.UserAgent). Enables the cloud-portal
   * "Active Sessions → Device/Location" view. Built by `userAgentFromRequest()`
   * in `app/server/user-agent.ts`. Omit when no request context is available
   * (e.g. server-side-only session refresh paths).
   *
   * Shape mirrors ZitadelUserAgent from user-agent.ts:
   *   fingerprintId? — opaque client fingerprint id
   *   ip?            — client IP (last-hop XFF)
   *   description?   — human-readable browser/device/OS string
   *   header?        — map<string, { values: string[] }> (proto HeaderValues)
   */
  userAgent?: {
    fingerprintId?: string;
    ip?: string;
    description?: string;
    header?: Record<string, { values: string[] }>;
  };
}

export interface RegisterInput {
  email: string;
  firstName: string;
  lastName: string;
  password?: string;
  orgId?: string;
  idpLink?: unknown;
  /**
   * Optional verification-email URL template. When set, the provider's email
   * verification message links back to THIS url (placeholders the provider fills:
   * {{.Code}}, {{.UserID}}, {{.OrgID}}) instead of the provider's built-in page —
   * so the "click the link" continuation lands on our own /verify route. Routes
   * build it as `/verify?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}`.
   */
  verifyUrlTemplate?: string;
  /**
   * When true, the provider does NOT send a verification email — it returns the plaintext
   * code on the register result instead (Zitadel: AddHumanUserResponse.emailCode), so the
   * caller can deliver it through its own pipeline. Takes precedence over verifyUrlTemplate
   * (both request provider-side email verification; returnCode is the newer, self-delivery
   * mechanism). Ignored when emailVerified is true.
   */
  returnCode?: boolean;
  /**
   * When true, the user is created with an already-verified email (no verification
   * code is sent). Used on the IdP register path where the IdP has already vouched
   * for the email address. Takes precedence over verifyUrlTemplate and returnCode.
   */
  emailVerified?: boolean;
}

/**
 * The result of `register()`. Almost always a plain `User`; `emailCode` is present ONLY when
 * the input requested `returnCode: true` (and `emailVerified` was not set) — the plaintext
 * email-verification code, returned in-band instead of being emailed by the provider, for
 * the caller to deliver through its own pipeline.
 *
 * SECURITY: `emailCode` is a bearer credential — never log it.
 */
export type RegisterResult = User & { emailCode?: string };

export interface AuthProvider {
  readonly capabilities: ProviderCapabilities;

  // settings
  getLoginSettings(orgId?: string): Promise<LoginSettings>;
  getBranding(orgId?: string): Promise<BrandingTheme>;
  // Tightened from Promise<unknown> — mappers already produce PasswordComplexity;
  // undefined when the provider omits the password-complexity settings block.
  getPasswordComplexity(orgId?: string): Promise<PasswordComplexity | undefined>;
  getActiveIdPs(orgId?: string): Promise<IdProvider[]>; // P4
  // getLegalSupport removed — it had zero callers (dead port method).
  /**
   * The instance Default Organization id, or null when the provider exposes no default. Used by the
   * org-first / default-org fallback (`resolveOrg`) so a login without an explicit org still lands
   * on the real instance org's IdPs/branding instead of the INSTANCE/default context. The result is
   * stable for the life of the instance, so callers memoize it.
   */
  getDefaultOrg(): Promise<string | null>;

  // users
  findUser(identifier: string, orgId?: string): Promise<User | null>;
  /**
   * Domain discovery (settings-gated, default-off). Given an email domain, resolve the
   * organization it belongs to, or null when no org claims it. Used by resolveIdentifier
   * only when settings.allowDomainDiscovery is true.
   */
  findOrgByDomain(domain: string): Promise<{ orgId: string } | null>;
  getUser(id: string): Promise<User | null>;
  listAuthMethods(userId: string): Promise<AuthMethod[]>;
  register(input: RegisterInput): Promise<RegisterResult>; // P2

  // session
  createSession(checks: SessionChecks, opts?: SessionOpts): Promise<Session>;
  getSession(id: string, token: string): Promise<Session | null>;
  updateSession(id: string, token: string, checks: SessionChecks): Promise<Session>;
  deleteSession(id: string, token: string): Promise<void>;
  // P5 — read-only enrichment: returned sessions carry token: '' (tokens live only in the session cookie)
  listSessions(ids: string[]): Promise<Session[]>; // P5

  /**
   * All of the user's provider-side sessions (cross-device). Read-only enrichment:
   * returned sessions carry token: '' (tokens live only in the session cookie), so they
   * cannot be used with updateSession/deleteSession; pair with deleteUserSession.
   */
  listUserSessions(userId: string): Promise<Session[]>;
  /**
   * Privileged token-less session deletion via the provider's service credential
   * (the cross-device sign-out primitive). Callers gate this behind sudo.
   */
  deleteUserSession(sessionId: string): Promise<void>;

  // password
  sendPasswordReset(userId: string, urlTemplate: string): Promise<void>; // P2
  setPasswordWithCode(userId: string, code: string, password: string): Promise<void>; // P2
  changePasswordWithSession(sessionId: string, token: string, password: string): Promise<void>; // P2

  // verification
  sendEmailCode(userId: string, urlTemplate: string): Promise<void>; // P2
  verifyEmail(userId: string, code: string): Promise<void>; // P2
  verifyInvite(userId: string, code: string): Promise<void>; // P2
  /**
   * Resend the verification email via provider-sent mail (sendCode delivery) — the provider
   * emails a link back to `urlTemplate`. Renamed from `resendEmailCode` so that name is free
   * for the returnCode-delivery variant below.
   */
  resendEmailCodeWithUrl(userId: string, urlTemplate: string): Promise<void>; // P2
  /**
   * Resend the verification email via returnCode delivery: the provider does NOT send mail —
   * it returns the plaintext code so the caller can deliver it through its own pipeline.
   *
   * SECURITY: the returned code is a bearer credential — never log it.
   */
  resendEmailCode(userId: string): Promise<string>;

  // protocol (oidc / saml)
  getAuthRequest(kind: 'oidc' | 'saml', requestId: string): Promise<AuthRequest>;
  createCallback(
    authRequestId: string,
    session: { id: string; token: string }
  ): Promise<{ callbackUrl: string }>;

  // external idp ─ (P4)
  startIdpIntent(
    idpId: string,
    urls: { success: string; failure: string }
  ): Promise<{ authUrl?: string; formData?: unknown }>; // P4
  // Tightened from Promise<unknown> — mappers already produce IdpIntentResult.
  retrieveIdpIntent(idpIntentId: string, token: string): Promise<IdpIntentResult>; // P4
  // Tightened from Promise<unknown[]> — both implementations return IdpLink[].
  listIdpLinks(userId: string): Promise<IdpLink[]>; // P4
  // Tightened from unknown — the link shape is always IdpLink.
  addIdpLink(userId: string, link: IdpLink): Promise<void>; // P4
  removeIdpLink(userId: string, idpId: string, linkedUserId: string): Promise<void>; // P4

  // webauthn (passkey + u2f) ─ (P5)
  passkeyRegisterLink(userId: string): Promise<{ code: string }>; // P5
  // Tightened from Promise<unknown> — the adapter narrows the raw provider response into
  // WebAuthnCreationOptions; routes treat the inner publicKey value as opaque.
  registerPasskey(userId: string, code: string, domain: string): Promise<WebAuthnCreationOptions>; // P5
  verifyPasskey(
    userId: string,
    passkeyId: string,
    cred: unknown,
    passkeyName?: string
  ): Promise<void>; // P5
  // Passkey inventory (management page). state maps AuthFactorState → READY='active'.
  // createdAt (ISO) joined from Zitadel user metadata; absent when unknown
  // (pre-existing enrollment or metadata degrade).
  listPasskeys(
    userId: string
  ): Promise<Array<{ id: string; state: 'active' | 'inactive'; name: string; createdAt?: string }>>;
  // Removing an unknown id is treated as idempotent success by callers (removal race).
  removePasskey(userId: string, passkeyId: string): Promise<void>;
  // Tightened from Promise<unknown> — see registerPasskey (U2F analogue).
  registerU2F(userId: string, domain: string): Promise<U2FCreationOptions>; // P5
  verifyU2F(userId: string, cred: unknown): Promise<void>; // P5

  // otp/totp ─ (P5)
  registerTotp(userId: string): Promise<{ uri: string; secret: string }>; // P5
  verifyTotp(userId: string, code: string): Promise<void>; // P5
  addOtpEmail(userId: string): Promise<void>; // P5
  addOtpSms(userId: string): Promise<void>; // P5

  // mfa skip ─ (P5)
  setMfaInitSkipped(userId: string): Promise<void>; // P5 — records a forced-MFA-setup skip; surfaced as User.mfaInitSkippedAt

  // device grant ─ (P6)
  getDeviceAuth(userCode: string): Promise<DeviceAuthRequest>; // P6
  authorizeDevice(
    deviceAuthId: string,
    decision: { session?: { id: string; token: string } }
  ): Promise<void>; // P6

  // saml ─ (P6)
  createSamlResponse(
    samlRequestId: string,
    session: { id: string; token: string }
  ): Promise<SamlResponse>; // P6

  // ldap ─ (P6)
  startLdapIntent(idpId: string, username: string, password: string): Promise<LdapIntent>; // P6

  // idp auto-link helpers
  /**
   * Mark the user's current email as verified without sending a code.
   * Implementation: request a returnCode email-verification code then immediately
   * call verifyEmail with it. Used after IdP auto-link when the IdP has already
   * vouched for the email address.
   */
  markEmailVerified(userId: string): Promise<void>;

  // admin routing
  /**
   * True iff the session's user holds an instance-level (IAM) membership — used to route
   * admins to the Zitadel console. Reads the caller's memberships with the session token.
   * Fail-safe: any error resolves to false.
   */
  isInstanceAdmin(session: { id: string; token: string }): Promise<boolean>;
}
