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
  ProviderCapabilities,
  IdProvider,
  SamlResponse,
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
     * `true` requests the email-OTP code with the provider's default link. Pass an object
     * with `urlTemplate` (built by flows/otp-email-url-template.ts) to override the emailed
     * link so it lands on OUR /id/login/verify/email route instead of the provider's default
     * /ui/v2/login/otp/email page. The mapper sets proto OTPEmail.SendCode.url_template from it.
     * Pass `{ returnCode: true }` to request a return-code challenge — the OTP code is NOT
     * emailed; instead it is returned on the session under Session.challenges.otpEmailCode.
     */
    otpEmail?: boolean | { urlTemplate?: string } | { returnCode: true };
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
   * When true, the user is created with an already-verified email (no verification
   * code is sent). Used on the IdP register path where the IdP has already vouched
   * for the email address. Takes precedence over verifyUrlTemplate.
   */
  emailVerified?: boolean;
}

export interface AuthProvider {
  readonly capabilities: ProviderCapabilities;

  // settings
  getLoginSettings(orgId?: string): Promise<LoginSettings>;
  getBranding(orgId?: string): Promise<BrandingTheme>;
  getPasswordComplexity(orgId?: string): Promise<unknown>;
  getActiveIdPs(orgId?: string): Promise<IdProvider[]>; // P4
  getLegalSupport(orgId?: string): Promise<unknown>;

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
  register(input: RegisterInput): Promise<User>; // P2

  // session
  createSession(checks: SessionChecks, opts?: SessionOpts): Promise<Session>;
  getSession(id: string, token: string): Promise<Session | null>;
  updateSession(id: string, token: string, checks: SessionChecks): Promise<Session>;
  deleteSession(id: string, token: string): Promise<void>;
  // P5 — read-only enrichment: returned sessions carry token: '' (tokens live only in the session cookie)
  listSessions(ids: string[]): Promise<Session[]>; // P5

  // password
  sendPasswordReset(userId: string, urlTemplate: string): Promise<void>; // P2
  setPasswordWithCode(userId: string, code: string, password: string): Promise<void>; // P2
  changePasswordWithSession(sessionId: string, token: string, password: string): Promise<void>; // P2

  // verification
  sendEmailCode(userId: string, urlTemplate: string): Promise<void>; // P2
  verifyEmail(userId: string, code: string): Promise<void>; // P2
  verifyInvite(userId: string, code: string): Promise<void>; // P2
  resendEmailCode(userId: string, urlTemplate: string): Promise<void>; // P2

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
  // CODE-MIN-03: tightened from Promise<unknown> — mappers already produce IdpIntentResult.
  retrieveIdpIntent(idpIntentId: string, token: string): Promise<IdpIntentResult>; // P4
  // CODE-MIN-03: tightened from Promise<unknown[]> — both implementations return IdpLink[].
  listIdpLinks(userId: string): Promise<IdpLink[]>; // P4
  // CODE-MIN-03: tightened from unknown — the link shape is always IdpLink.
  addIdpLink(userId: string, link: IdpLink): Promise<void>; // P4
  removeIdpLink(userId: string, idpId: string, linkedUserId: string): Promise<void>; // P4

  // webauthn (passkey + u2f) ─ (P5)
  passkeyRegisterLink(userId: string): Promise<{ code: string }>; // P5
  registerPasskey(userId: string, code: string, domain: string): Promise<unknown>; // P5 — returns raw credential creation options; adapter narrows, routes treat as opaque
  verifyPasskey(
    userId: string,
    passkeyId: string,
    cred: unknown,
    passkeyName?: string
  ): Promise<void>; // P5
  registerU2F(userId: string, domain: string): Promise<unknown>; // P5 — returns raw credential creation options; adapter narrows, routes treat as opaque
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
