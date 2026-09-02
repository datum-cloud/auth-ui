// cypress/support/node/scenario.ts
//
// Serializable contract shared across the cy.task node-spec boundary. Specs (browser bundle)
// import the TYPES from here to shape a scenario and read back a verdict; the Bun-side harness
// (harness.ts / run-scenario.ts) imports the same types to interpret the scenario and run the
// REAL services. Keep this file pure types + string-literal unions: it is bundled into BOTH the
// browser spec bundle and the Bun runner, so it must never import an app value module.

/** Provider error codes the fake's scripting seams + the services understand. Open union: a
 *  bare string is accepted so future codes don't break the contract. */
export type ProviderErrorCode =
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'UNAVAILABLE'
  | 'DEADLINE_EXCEEDED'
  | 'RATE_LIMITED'
  | 'ALREADY_DONE'
  | 'FAILED_PRECONDITION'
  | 'INVALID_CREDENTIALS'
  | 'UNKNOWN'
  | (string & {});

/** The FakeAuthProvider constructor seed, narrowed to the JSON-serializable subset the ported
 *  specs actually use. Mirrors the real `Seed` shape (see fake-provider.ts). */
export interface ScenarioSeed {
  users?: Array<{ id: string; loginName: string; displayName?: string; orgId?: string }>;
  passwords?: Record<string, string>;
  authMethods?: Record<string, string[]>;
  authRequests?: Record<
    string,
    { id: string; clientId?: string; scopes: string[]; prompt: string[]; loginHint?: string }
  >;
  settingsByOrg?: Record<string, Record<string, unknown>>;
  /**
   * Email domain → orgId (fake-provider.ts's `orgDomains`), what findOrgByDomain answers from.
   * Needed by any spec exercising domain-derived org resolution — both the allowDomainDiscovery
   * routing path and the GHOST policy read (resolveGhostPolicyOrg), which uses it to judge an
   * unknown identifier under the org that claims its domain.
   */
  orgDomains?: Record<string, string>;
  /** Instance Default Organization getDefaultOrg returns (org-first fallback). Default
   *  'org-default-fake' in the fake; pass `null` for the "no default org" last-resort branch. */
  defaultOrgId?: string | null;

  /**
   * Partial capability override applied over the FakeAuthProvider class defaults.
   * Use to simulate an instance that offers no MFA enrollment methods — e.g. all MFA
   * capabilities false triggers the resolveMfaSetup auto-skip path.
   */
  capabilities?: Partial<Record<string, boolean>>;
  deviceAuths?: Array<{ userCode: string; id: string; appName?: string; scope: string[] }>;
  samlRequests?: Array<{ id: string; clientId: string; binding: 'redirect' | 'post' }>;
  /** FakeAuthProvider's own idpIntents seed, narrowed to the one field the idp-reauth
   *  tests read (userId) — the real IdpIntentResult also carries information/draft,
   *  unused by updateSession's idpIntent check. */
  idpIntents?: Record<
    string,
    { idpIntentId: string; idpIntentToken: string; userId: string | null }
  >;
  /** Active org IdPs (getActiveIdPs) — narrowed to the fields joinLinkedIdps reads. */
  idps?: Array<{ id: string; name: string; type: string; logoUrl?: string }>;
  /** Pre-linked IdP identities (userId → links), narrowed to the fields joinLinkedIdps reads. */
  idpLinks?: Record<string, Array<{ idpId: string; idpUserId: string; idpUserName?: string }>>;
}

/** A live session to inject via provider.seedLiveSession (getSession/listSessions resolve it). */
export interface LiveSessionSeed {
  id: string;
  token: string;
  user?: { id: string; loginName: string; displayName?: string };
}

/** A cookie entry the harness signs into a real `sessions` cookie via the REAL cookie module. */
export interface CookieSessionSpec {
  id: string;
  token: string;
  loginName: string;
  organization?: string;
  creationTs?: string;
  expirationTs?: string;
  changeTs?: string;
  requestId?: string;
}

/** The request the harness builds (duck-typed: services only read `.url` + `.headers.get`). */
export interface RequestSpec {
  url: string;
  /** Cookie entries → a validly-signed `sessions` cookie header. Omit for a no-cookie request. */
  sessions?: CookieSessionSpec[];
  /** Form fields → FormData (action services take a parsed FormData, never request.formData()). */
  form?: Record<string, string>;
  /** HTTP method for the duck-typed request. Defaults to 'POST' when `form` is present, else 'GET'. */
  method?: string;
  /** Raw (unsigned) `fingerprintId=<value>` cookie — mirrors the OLD-app fingerprint cookie a
   *  browser already carries. Merged into the Cookie header alongside `sessions`. */
  fingerprintId?: string;
  /** A loginName signed into a REAL `reauth-intent` cookie (readReauthIntent/checkReauthIntent
   *  read it). Merged into the Cookie header alongside `sessions`. */
  reauthIntent?: string;
  /** Mint a REAL CSRF token+cookie (getCsrfToken): the cookie is merged into the Cookie header and
   *  the token is injected into `form` under the `csrf` key so an action's assertCsrf passes. The
   *  whole reason the otp-verify ACTION specs are node-bound is this signed CSRF round-trip. */
  csrf?: boolean;
  /** Signed last-used-login cookie value (e.g. 'email', 'passkey', 'idp:google'). Merged into the
   *  Cookie header so loginLoader's readLastUsedLogin returns the value on the spec. */
  lastUsedLogin?: string;
  /** A loginName signed into a REAL `passkey-hint` cookie (readPasskeyHint reads it).
   *  Merged into the Cookie header alongside `sessions`. */
  passkeyHint?: string;
  /** A loginName signed into a REAL `idp-autostart` cookie — the one-shot marker
   *  /login/method's loader writes when it auto-starts a sole linked IdP. Present ⇒ this
   *  browser is on its SECOND arrival for that account and must get the chooser, not a
   *  freshly minted intent. */
  idpAutostart?: string;
  /**
   * Append the `policyOrg` + `policyOrgSig` pair the START side would have minted for this org,
   * produced by the REAL `idpReturnUrls` signer.
   *
   * A spec that hand-wrote the signature would only prove the verifier agrees with itself; going
   * through the producer proves the round-trip that actually ships. Leave it off (and write a
   * bare `?policyOrg=` into the url) to exercise the FORGED case.
   */
  signPolicyOrg?: string;
  /**
   * Applied AFTER `signPolicyOrg`: replace the `policyOrg` value while keeping the signature
   * minted for the original one. Models the realistic forgery — a signature lifted from a
   * legitimate start and pasted next to a different org — rather than a random digest.
   */
  tamperPolicyOrg?: string;
}

/** A serializable IdP intent, injected via the SSO callback's `retrieveIdpIntent` DI seam.
 *  Mirrors the JSON-serializable subset of the real `IdpIntentResult`. */
export interface ScenarioIdpIntent {
  userId: string | null;
  information: { idpId: string; idpUserId: string; idpUserName: string };
  draft?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
    emailVerified?: boolean;
  } | null;
}

/** The serializable subset of SignInWithIdpIntentOpts the ported reauth specs drive. */
export interface ScenarioSignInOpts {
  idpIntentId: string;
  idpIntentToken: string;
  userId: string;
  fallbackLoginName?: string;
  requestId?: string;
  organization?: string;
}

/** Which real service entrypoint the task drives. */
export type ServiceFn =
  | 'resolveAuthorize'
  | 'resolveSignedIn'
  | 'switchAccount'
  | 'removeAccount'
  | 'listAccounts'
  | 'performLogout'
  | 'completeOidcLogout'
  | 'lookupDeviceCode'
  | 'loadDeviceConsent'
  | 'resolveDeviceDecision'
  // ── sso (batch 8b) ──
  | 'processIdpCallback'
  | 'signInWithIdpIntent'
  | 'reauthAction'
  | 'reauthProviderCallback'
  | 'submitLdapCredentials'
  | 'runSsoAction'
  // sso IdP-DISPLAY flows: org-first / default-org fallback probes. Each reads a real Request +
  // seeded fake provider node-side so recordCalls can capture the org threaded into getActiveIdPs
  // (empty org → the resolved default org, not undefined → the INSTANCE/default IdPs).
  | 'resolveSsoLink'
  | 'resolveSsoManagement'
  | 'activeIdPsProbe'
  // ── mfa / otp / webauthn services (batch 8d) ──
  // All read a SessionEntry[] / OtpSessionEntry directly and emit REAL audit (logAuthEvent →
  // console.log), so they run node-side: the browser bundle stubs observability to a no-op.
  | 'chooseMfaMethod'
  | 'resolveMfaPicker'
  | 'resolveMfaSetup'
  | 'dispatchEmailChallenge'
  | 'submitOtpCode'
  | 'requestPasskeyAttestation'
  | 'requestU2FAttestation'
  | 'requestWebAuthnChallenge'
  | 'verifyPasskeyEnrollment'
  | 'verifyU2FEnrollment'
  // createOtpVerifyHandlers loader/action — read a signed sessions cookie (+ CSRF for the action)
  // off a Request, so they are node-bound (the Fetch spec forbids a Cookie header in the browser).
  | 'otpVerifyLoader'
  | 'otpVerifyAction'
  // createOtpEnrollHandlers loader — same node-bound reason (signed sessions cookie off a real
  // Request). Covers the guard-fail /login bounce (otp-enroll.ts) threading requestId/organization.
  | 'otpEnrollLoader'
  // Parse a raw env object through the REAL env.server Zod schema (SEC-5 ALLOW_IDP_UNLINK
  // coercion). env.server is stubbed out of the browser bundle, so this must run node-side.
  | 'parseEnv'
  // ── signup service (batch 8e) ──
  // vi.mock('@/server/observability') makes audit-shape assertions impossible in the browser bundle
  // (observability is stubbed to a no-op). Real audit runs in Bun node-side.
  | 'registerWithPassword'
  | 'registerPasskeyFirst'
  | 'registerEmailLinkSignup'
  | 'registerAndLinkIdp'
  | 'completeEmailLinkSignup'
  // ── verify service (batch 8e) ──
  // Security-critical session-ownership gate (anti-enumeration) + URL template contract run
  // node-side so real provider methods (sendEmailCode, getSession) can be scripted via overrides.
  | 'dispatchEmailCode'
  | 'resendEmailCode'
  | 'submitEmailCode'
  // ── server/* checks (Task 10) ────────────────────────────────────────────────
  // Tests for app/server/**  — node:crypto (hashActor), prom-client (registry), Hono middleware
  // (httpMetrics, rate-limit, samlPostHandler), Cookie header round-trips (CSRF, user-agent,
  // composition). All run in a fresh Bun process via cy.task so they bypass the Vite stubs.
  | 'compositionCheck'
  | 'csrfFoundationsCheck'
  | 'csrfCheck'
  | 'observabilityCheck'
  | 'userAgentCheck'
  | 'rateLimitCheck'
  | 'samlPostCheck'
  // ── transport cache (9a fidelity fix) ────────────────────────────────────────
  // Exercises the REAL transport.ts (SHA-256 fingerprint + @zitadel/client/node) in Bun.
  // Each cy.task call spawns a fresh Bun process so the module-level Maps start empty.
  | 'transportCacheCheck'
  // ── session-cookie / signing (batch 9b) ──────────────────────────────────────
  // The cookie / last-used-login / reauth-intent modules are stubbed out of the Vite browser
  // bundle (env.server + react-router HMAC signing), so their REAL signing/parsing/audit
  // round-trips run node-side. Each is a discriminated op (mirrors transportCacheCheck): the
  // harness runs the REAL function and returns raw data + captured audit; the spec keeps every
  // Chai assertion browser-side.
  | 'cookieGuardCheck'
  | 'cookieRoundTripCheck'
  | 'lastUsedLoginCheck'
  | 'passkeyHintCheck'
  | 'reauthIntentCheck'
  // select.server is stubbed in the browser bundle (a fake-only registry), so the REAL
  // provider-selection binding point (fake↔zitadel) is exercised node-side.
  | 'selectProvider'
  // ── Task 11 migrations ───────────────────────────────────────────────────────
  // env.server._envSchema — comprehensive Zod schema validation. Returns full
  // { success, data?, issues? } so specs can assert any field without re-implementing the schema.
  | 'envSchemaFull'
  // resolveOrg precedence probe (org-first / default-org fallback). Runs node-side because the
  // env pin (ZITADEL_DEFAULT_ORG_ID) is stubbed to `{}` in the browser bundle; here the REAL env
  // schema is loaded, so the env branch is reachable. Returns { org: string | null }.
  | 'resolveOrgProbe'
  // Hono /metrics route pinning test — unauthenticated GET returns 200 + metric name.
  | 'serverMetrics'
  // ── routes/login handlers (batch 13b) ────────────────────────────────────────
  // Login route loaders/actions are node-bound: they read a signed `sessions` cookie off a real
  // Request (Cookie header blocked by Fetch spec in the browser), and some need the signed
  // `last-used-login` / `reauth-intent` cookies that buildCookieHeader composes for the spec.
  | 'loginLoader'
  | 'loginAction'
  | 'loginPasswordAction'
  | 'loginPasskeyAction'
  // /login/passkey loader: the challenge-arming half of the verify ceremony. Covers the
  // stale-session self-heal end-to-end — the re-minted session must reach the browser as a
  // Set-Cookie or the assertion that follows verifies against the wrong session.
  | 'loginPasskeyLoader'
  // /login/passkey-discover action: identity-resolution step of the usernameless
  // discovery path — userHandle → user-bound challenge (opaque 400s on failure).
  | 'passkeyDiscoverAction'
  | 'loginPasswordLoader'
  | 'securityKeyAction'
  | 'loginVerifyEmailLoader'
  | 'loginMethodLoader'
  | 'loginMethodAction'
  // login/mfa.tsx action: covers the SESSION_EXPIRED path now returning inline data() (instead
  // of a hard redirect(paths.login.index())) so useAuthActionRecovery's banner can thread
  // requestId/organization.
  | 'loginMfaAction'
  // ── routes/device + routes/signup handlers (batch 13c) ───────────────────────
  // Route loaders/actions are node-bound: they call providerForRequest (server-only composition),
  // read signed cookies off a real Request (Cookie header blocked in the browser), and need REAL
  // HMAC CSRF round-trips. Each case uses buildHandlerRequest so assertCsrf passes.
  | 'deviceAuthorizeLoader'
  | 'deviceAuthorizeAction'
  | 'deviceCompleteLoader'
  | 'deviceIndexLoader'
  | 'signupCompleteLoader'
  | 'signupMethodLoader'
  | 'signupMethodAction'
  | 'signupPasswordLoader'
  | 'signupPasswordAction'
  | 'signupIndexLoader'
  | 'signupIndexAction'
  // ── routes/accounts + logout + password + setup/authenticator + verify handlers (batch 13d) ──
  // Route loaders/actions are node-bound: they read a signed `sessions` cookie off a real Request
  // (Cookie header blocked by Fetch spec in the browser), call providerForRequest, and some need
  // REAL HMAC CSRF round-trips. Each case uses buildHandlerRequest.
  | 'accountsLoader'
  | 'accountsAction'
  | 'logoutLoader'
  | 'logoutSuccessLoader'
  | 'logoutAction'
  | 'passwordNewLoader'
  | 'passwordNewAction'
  | 'passwordChangeLoader'
  | 'passwordChangeAction'
  | 'passwordResetLoader'
  | 'passwordResetAction'
  | 'setupAuthenticatorLoader'
  | 'verifyIndexLoader'
  | 'verifyIndexAction';

export type SessionResultScript =
  | { mode: 'null' }
  | { mode: 'throw'; code: ProviderErrorCode }
  // Fails the FIRST getSession call for that id, then falls through to the real fake behavior —
  // drives the healIfSessionDead read-after-write retry tests ("fail once, then succeed").
  | { mode: 'throw-once'; code: ProviderErrorCode }
  // Fails the next `times` getSession calls, then falls through — drives the bounded-backoff-loop
  // test where a replica lags more than one read cycle ("fail N times, then succeed").
  | { mode: 'throw-times'; code: ProviderErrorCode; times: number };
export type CallbackResultScript = { mode: 'throw'; code: ProviderErrorCode };

export interface Scenario {
  fn: ServiceFn;
  /** 'singleton' = the richly-seeded process singleton (getAuthProvider); 'fresh' = new
   *  FakeAuthProvider(seed). Defaults to 'fresh' when `seed` is present, else 'singleton'. */
  provider?: 'singleton' | 'fresh';
  seed?: ScenarioSeed;
  request?: RequestSpec;
  /** Injected clock for resolveAuthorize's freshness gate (route default is Date.now()). */
  nowMs?: number;

  // ── provider scripting (built-in fake seams) ──────────────────────────────
  liveSessions?: LiveSessionSeed[];
  sessionResults?: Record<string, SessionResultScript>;
  callbackResults?: Record<string, CallbackResultScript>;
  instanceAdminSession?: string | null;
  loginDefaultRedirectUri?: string;

  // ── harness instance overrides (the cy.task equivalent of vi.spyOn) ────────
  /** getLoginSettings throws — exercises the post_login_settings failure + graceful degradation. */
  failLoginSettings?: boolean;
  /** Override getLoginSettings on the built provider — sets disableLoginWithEmail / disableLoginWithPhone
   *  so the rejection specs (email-rejection, phone-rejection) don't need a real org config entry.
   *  Also supports allowRegister (signup-track: registrationDisabled view flag). */
  mockLoginSettings?: {
    disableLoginWithEmail?: boolean;
    disableLoginWithPhone?: boolean;
    allowRegister?: boolean;
    /** Password disabled by org policy (Zitadel LoginPolicy.userLogin=false) — production's
     *  configuration. Drives the /login/password loader+action policy guard. */
    allowPassword?: boolean;
  };
  /** deleteSession throws — exercises completeOidcLogout's best-effort tolerance. */
  failDeleteSession?: boolean;
  /** startIdpIntent returns no authUrl — startIdpIntent() maps that to IDP_UNAVAILABLE, which
   *  /login/method's sole-IdP auto-start must FALL THROUGH from (render the button) rather than
   *  dead-ending the user on a screen with no way forward. */
  failStartIdpIntent?: boolean;
  /** getSession returns a session with a CONTROLLABLE password.verifiedAt (freshness gate). */
  freshness?: { sessionId: string; token: string; verifiedAtMs: number };
  /** Override getPasswordComplexity on the built provider (the cy.task equivalent of an org policy
   *  configured in Zitadel) so the password-setting routes' policy-driven rules can be exercised. */
  passwordComplexity?: {
    minLength: number;
    requiresUppercase: boolean;
    requiresLowercase: boolean;
    requiresNumber: boolean;
    requiresSymbol: boolean;
  };

  // ── sso callback / sign-in / action (batch 8b) ─────────────────────────────
  /** IdP provider slug for processIdpCallback (e.g. 'google'). */
  slug?: string;
  /** Resolved IdP intent injected via the callback's `retrieveIdpIntent` DI seam. */
  idpIntent?: ScenarioIdpIntent;
  /** retrieveIdpIntent rejects with ProviderError(code) — the transient-failure → error-page path. */
  idpIntentError?: ProviderErrorCode;
  /** markEmailVerified throws — exercises the best-effort verify-on-auto-link tolerance. */
  failMarkEmailVerified?: boolean;
  /** addIdpLink throws ProviderError(code) — 755-J1 link-failure reason mapping. */
  addIdpLinkError?: ProviderErrorCode;
  /** register throws ProviderError(code) — auto-create registration-failure reason mapping. */
  registerError?: ProviderErrorCode;
  /** register throws ProviderError(code) on the FIRST call only, then delegates to the real fake
   *  register() — drives the runEnumerationSafeRegister read-after-write retry test ("register
   *  throws transient NOT_FOUND once then succeeds"). */
  registerErrorOnce?: ProviderErrorCode;
  /** Opts for signInWithIdpIntent (the LDAP/callback shared sign-in helper). */
  signInOpts?: ScenarioSignInOpts;
  /** runSsoAction DI startIdpIntent rejects with ProviderError(code) — handled (no 500). */
  startIdpIntentError?: ProviderErrorCode;
  /** Raw env object fed to the REAL _envSchema (the `parseEnv` fn). */
  parseEnvRaw?: Record<string, string>;
  /** Input for the `resolveOrgProbe` fn — the explicit URL/scope org (or omit for the fallback). */
  resolveOrgInput?: { urlOrg?: string };

  // ── mfa / otp / webauthn services (batch 8d) ───────────────────────────────
  /** Ctx for chooseMfaMethod / resolveMfaPicker / resolveMfaSetup (loginName + threaded params).
   *  The session list itself comes from `request.sessions` (mapped to SessionEntry[]). */
  mfaInput?: { loginName: string; requestId?: string; organization?: string };
  /** Ctx for requestPasskeyAttestation / requestU2FAttestation (`domain` = FIDO2 relying party). */
  attestationInput?: {
    loginName: string;
    requestId?: string;
    organization?: string;
    domain: string;
  };
  /** Ctx for dispatchEmailChallenge. `origin` is a TRUSTED value passed in (never the Host header). */
  emailChallengeInput?: {
    origin: string;
    loginName: string;
    requestId?: string;
    organization?: string;
  };
  /** Input for verifyPasskeyEnrollment / verifyU2FEnrollment (posted credential + per-factor id). */
  verifyEnrollInput?: {
    credential: string;
    passkeyId?: string;
    u2fId?: string;
    loginName: string;
    requestId?: string;
    organization?: string;
    checkAfter?: 'true' | 'false';
  };
  /** Channel for submitOtpCode (the verify field + code schema it drives). */
  otpChannel?: 'email' | 'sms' | 'authenticator';
  /** Config for createOtpVerifyHandlers (otpVerifyLoader / otpVerifyAction). */
  otpVerifyConfig?: {
    channel: 'email' | 'sms' | 'authenticator';
    suppressChallengeOnCode?: boolean;
    nextParamHandling?: 'passkey-redirect' | 'none';
    writeLastUsedLogin?: 'email' | false;
    verifyPath: string;
  };
  /** Config for createOtpEnrollHandlers (otpEnrollLoader). `enroll`/`factor` aren't needed for
   *  the loader-only guard-fail coverage this drives, so only `verifyPath` is required. */
  otpEnrollConfig?: {
    verifyPath: string;
  };

  // ── harness instance overrides for 8d (vi.spyOn equivalents) ───────────────
  /** findUser throws — chooseMfaMethod best-effort-audit failure path (routing must continue). */
  failFindUser?: boolean;
  /** passkeyRegisterLink throws a plain Error (→ typed 'UNKNOWN' code) — graceful challenge degrade. */
  failPasskeyRegisterLink?: boolean;
  /** passkeyRegisterLink throws ProviderError(code) — the TYPED challenge-failure code path. */
  passkeyRegisterLinkError?: ProviderErrorCode;
  /** verifyPasskey throws ProviderError(code) — the INVALID_CREDENTIALS enroll-failure path. */
  failVerifyPasskey?: ProviderErrorCode;
  /** verifyU2F throws ProviderError(code) — the INVALID_CREDENTIALS enroll-failure path. */
  failVerifyU2F?: ProviderErrorCode;

  // ── service config + capture ──────────────────────────────────────────────
  signedInConfig?: { consoleUrl: string; defaultAppUrl?: string };
  /** Wrap these provider methods to record their call args (e.g. listAuthMethods N+1, deleteSession). */
  recordCalls?: Array<
    | 'listAuthMethods'
    | 'deleteSession'
    | 'getUser'
    | 'startIdpIntent'
    | 'addIdpLink'
    // org-first / default-org fallback: capture the org arg threaded into the settings/IdP reads
    // and whether the provider default-org lookup ran.
    | 'getLoginSettings'
    | 'getBranding'
    | 'getActiveIdPs'
    | 'getDefaultOrg'
    // password-complexity policy: capture the org arg threaded into getPasswordComplexity.
    | 'getPasswordComplexity'
    // 8d: capture the provider sequence/args the mfa/otp/webauthn services drive.
    | 'updateSession'
    | 'passkeyRegisterLink'
    | 'registerPasskey'
    | 'registerU2F'
    | 'verifyPasskey'
    | 'verifyU2F'
    | 'findUser'
    // 8e: signup / verify service call recording.
    | 'register'
    | 'sendEmailCode'
    | 'resendEmailCode'
    | 'verifyEmail'
    | 'verifyInvite'
  >;
  /** Provider state to read back after the call. */
  inspect?: {
    isDeviceAuthorized?: string[];
    /** userId → emailVerified bool (markEmailVerified observability). */
    isEmailVerified?: string[];
    /** loginName → { id, displayName, emailVerified } | null (auto-create read-back). */
    findUser?: string[];
    /** Read lastCreateSessionOpts.userAgent.fingerprintId (the fingerprintId thread test). */
    lastCreateSessionFingerprintId?: boolean;
    /** Read the full lastCreateSessionOpts object (batch 8e: metadata / userAgent assertions). */
    lastCreateSessionOpts?: boolean;
    /**
     * HMAC round-trip the `sessions` cookie the service WROTE (outcome.setCookie) back into
     * entries, via the REAL cookie module. Lets a spec assert which identity was persisted —
     * not merely that some cookie was set. Null when the outcome carries no `sessions=` cookie.
     */
    cookieSessions?: boolean;
  };
  // ── signup service inputs (batch 8e) ────────────────────────────────────────────────────────
  /** Input struct for the signup service functions (registerWithPassword, registerPasskeyFirst,
   *  registerEmailLinkSignup, registerAndLinkIdp, completeEmailLinkSignup). */
  signupInput?: {
    email: string;
    firstName: string;
    lastName: string;
    password?: string;
    requireVerification?: boolean;
    origin?: string;
    organization?: string;
    requestId?: string;
    deviceTrackingToken?: string;
    userAgent?: unknown;
    // IdP link fields (registerAndLinkIdp)
    idpIntentId?: string;
    idpIntentToken?: string;
    idpId?: string;
    idpUserId?: string;
    idpUserName?: string;
    // Email-link completion fields (completeEmailLinkSignup)
    userId?: string;
    /** Email verification code from the completion link (verifyEmail check in completeEmailLinkSignup). */
    code?: string;
    loginName?: string;
    next?: string;
  };

  // ── verify service inputs (batch 8e) ─────────────────────────────────────────────────────────
  /** Input for dispatchEmailCode / resendEmailCode / submitEmailCode. */
  verifyEmailInput?: {
    userId: string;
    origin: string;
    invite: boolean;
    requestId?: string;
    // submitEmailCode form fields
    code?: string;
    loginName?: string;
    organization?: string;
    isSessionActive?: boolean;
  };
  /** sendEmailCode throws ProviderError(code) — exercises dispatchEmailCode error handling. */
  failSendEmailCode?: ProviderErrorCode;
  /** resendEmailCode throws ProviderError(code) — exercises resendEmailCode error handling. */
  failResendEmailCode?: ProviderErrorCode;
  /** verifyEmail throws ProviderError(code) — exercises submitEmailCode error handling. */
  failVerifyEmail?: ProviderErrorCode;
  /** getSession throws — exercises the fail-closed gate in dispatchEmailCode. */
  failGetSession?: boolean;

  /** Extra process env to set BEFORE the app modules load (e.g. POST_LOGOUT_ALLOWLIST). */
  env?: Record<string, string>;

  // ── server/* checks (Task 10) ────────────────────────────────────────────────
  compositionOp?:
    | 'fakeProvider' // AUTH_PROVIDER=fake → providerForRequest returns object with listSessions
    | 'noZitadelImport' // auth-context.server.ts source does NOT import /providers/zitadel
    | 'authContextReexport'; // dynamic import of auth-context.server exposes providerForRequest

  csrfFoundationsOp?:
    | 'loaderCsrfToken' // loaderCsrf(req) → { csrfToken: string (nonempty), headers }
    | 'setCookieNotNull' // headers['set-cookie'] absent or a real string (never literal 'null')
    | 'formKeyInSource'; // csrf.ts source contains 'CSRF_FORM_KEY'

  csrfOp?:
    | 'roundTrip' // getCsrfToken + assertCsrf → resolves without throw
    | 'forgedToken' // wrong token in form → Response(403)
    | 'missingToken' // no csrf field in form → Response(403)
    | 'missingCookie' // no cookie header → Response(403)
    | 'csrfErrorClass' // CSRFError is a constructor; new CSRFError(...) instanceof Error
    | 'nonCsrfErrorRethrow'; // assertCsrfWith(req, fd, () => throw boom) → boom rethrown

  observabilityOp?:
    | 'hashActorDeterministic' // 16 hex chars; same input → same output
    | 'hashActorDiverse' // different inputs → different outputs; no echo
    | 'hashActorEmpty' // empty string → empty string
    | 'logAuthEventMetric' // auth_events_total appears in registry dump
    | 'logAuthEventAuditLine' // injected sink receives JSON with correct shape
    | 'logAuthEventExplicitTrace' // explicit traceId in fields → appears in JSON line
    | 'logAuthEventAlsTrace' // runWithTraceId → traceId auto-injected into line
    | 'logAuthEventNoTrace' // outside ALS → no traceId key in JSON
    | 'getTraceIdOutside' // getTraceId() outside ALS → undefined
    | 'auditSinkIsFunction' // auditSink exported and typeof === 'function'
    | 'auditSinkDefault' // logAuthEvent without sink → console.log intercepted
    | 'httpDurationMetric' // startTimer().end() → dump contains method/route/status labels
    | 'httpMetricsThrowing'; // throwing next → end() still called, status_code '500'

  userAgentOp?:
    | 'uaHeaderMapped' // user-agent header → header['user-agent'].values = [raw]
    | 'noUaHeader' // no user-agent → no header field
    | 'xffLastHop' // multi-hop XFF → ip = last hop
    | 'singleXff' // single-hop XFF → ip = that value
    | 'noXff' // no XFF → no ip field
    | 'descriptionRaw' // description = raw UA verbatim
    | 'descriptionTokens' // Macintosh + Mac OS X tokens present
    | 'descriptionMobile' // iPhone UA → description = that UA
    | 'descriptionCurl' // curl UA → description = 'curl/8.4.0'
    | 'noDescription' // no UA → no description
    | 'explicitFpId' // explicit fingerprintId param → result.fingerprintId
    | 'fpIdFromCookie' // fingerprintId cookie → result.fingerprintId
    | 'urlEncodedFpId' // URL-encoded cookie → decoded value
    | 'fpIdParamOverride' // param overrides cookie
    | 'noFpId' // neither param nor cookie → undefined
    | 'noFpIdCookie' // cookie has no fingerprintId → undefined
    | 'allFields' // all inputs → all fields populated
    | 'emptyRequest' // no headers, no fp → empty object (0 keys)
    | 'reuseExistingFp' // existing cookie → id reused, setCookie null
    | 'mintNewFp' // no cookie → mint UUID, setCookie not null
    | 'fpCookieAttrs' // Set-Cookie has Max-Age=31536000, Path=/, HttpOnly, SameSite=Lax
    | 'fpSecureFlag' // secure=true → Secure; secure=false → no Secure
    | 'fpDistinctMints' // two mints → distinct UUIDs
    | 'fpRoundTrip'; // minted id → userAgentFromRequest fingerprintId matches

  rateLimitOp?:
    | 'loginPasswordBlocked' // 5 POSTs ok, 6th → 429 + Retry-After + RATE_LIMITED
    | 'loginPasswordGetNoConsume' // GETs don't consume budget
    | 'loginPasswordTrailingSlash' // trailing slash shares budget with canonical
    | 'loginPasswordXffRotation' // rotating hop-0, fixed last hop → last hop bucket
    | 'webauthnBlocked' // 10 POSTs then 429
    | 'webauthnSharedBucket' // security-key + mfa share ip bucket
    | 'webauthnPasswordNoConsume' // /login/password doesn't consume webauthn budget
    | 'webauthnGetNoConsume' // GETs don't count
    | 'webauthnTrailingSlash' // trailing slash shares budget
    | 'mfaEnrollBlocked' // 15 then 429
    | 'mfaEnrollSharedPaths' // /setup/* paths share bucket
    | 'mfaEnrollGetNoConsume' // GETs don't count
    | 'accountsBlocked' // 15 then 429
    | 'accountsGetNoConsume' // GETs don't count
    | 'accountsIsolatedIps' // different IPs → separate buckets
    | 'verifyEmailBlocked' // 10 ?send=true then 429
    | 'loginMethodIntentBlocked' // 10 identified GETs for ONE loginName then 429 (tight tier)
    | 'loginMethodIntentPerLoginName' // a 2nd loginName from the same ip keeps its own budget
    | 'loginMethodIntentIpCeiling' // 120 GETs spread across loginNames then 429 (loose tier)
    | 'loginMethodIntentHtml429' // a top-level GET navigation 429s with HTML, not JSON
    | 'loginMethodIntentDataJson429' // the .data variant keeps the JSON body
    | 'loginMethodBareGetNoConsume' // GET without (or with an empty) ?loginName never counts
    | 'loginIdentifierBlocked' // 120 identifier POSTs then 429; .data shares it, GET does not
    | 'serverMountsChooserLimiters' // app/server.ts imports + mounts BOTH chooser GET tiers
    | 'verifyEmailNoSendNoConsume' // no ?send=true → no count
    | 'verifyEmailPostNoConsume'; // POST → not counted

  samlPostOp?:
    | 'handlerMissingId' // GET without ?id= → 400
    | 'handlerNoSession' // no cookie → 302 /id/login?requestId=saml_<id>
    | 'handlerPostBinding' // valid session + POST binding → 200 auto-submit form
    | 'handlerRedirectBinding' // valid session + redirect binding → 302 to SP url
    | 'handlerUnresolvable' // unresolvable SAML id → 302 /id/error
    | 'handlerMissingNonce' // POST binding, nonce not set → 500
    | 'handlerDeadSession' // dead (stale) session → 302 /id/login
    | 'handlerRedirectBadUrl'; // redirect binding with javascript: ACS url → 400 (assertHttpUrl gate)

  // ── transport cache check (fn: 'transportCacheCheck') ──────────────────────
  /** Which transport cache property to assert. Each cy.task call = fresh Bun process = fresh Maps. */
  transportOp?:
    | 'serverTransportCacheHit' // same url+token → same reference; outcome: { hit: boolean }
    | 'serverTransportCacheMiss' // different url → different reference; outcome: { miss: boolean }
    | 'serverTransportThrowsEmptyBase' // empty baseUrl → throws; outcome: { threw: boolean; message: string }
    | 'serverTransportThrowsEmptyToken' // empty token → throws; outcome: { threw: boolean; message: string }
    | 'clientCacheCap' // 500 inserts → size ≤ 256; outcome: { size: number; max: number }
    | 'clientCacheRotatedToken' // two tokens → different clients; outcome: { distinct: boolean }
    | 'clientCacheSameToken' // same token → same client; outcome: { reused: boolean }
    | 'sha256FingerprintDistinctness'; // tokens sharing 16-char prefix must key differently; outcome: { distinct: boolean }

  // ── session-cookie / signing checks (fn: 'cookieGuardCheck') ───────────────
  /** readSessions zod guard scenarios. Audit (logAuthEvent → console.log) is captured into
   *  verdict.auditLines so the spec asserts invalid_signature / malformed_payload exactly as the
   *  original vitest console-spy did. outcome: { count, firstId }. */
  cookieGuardOp?:
    | 'validRoundTrip' // sign [entry] → readSessions → 1 entry, NO audit
    | 'absent' // no cookie header → [] with NO audit
    | 'tamperedSignature' // flip chars mid-value → [] + invalid_signature audit
    | 'forgedWrongShape' // valid sig, wrong shape (same secret) → [] + malformed_payload audit
    | 'forgedNonArray'; // valid sig, non-array payload → [] + malformed_payload audit

  // ── cookie serialize/parse round-trip (fn: 'cookieRoundTripCheck') ─────────
  /** sessionsCookie serialize→parse + overflow/cap + cross-replica. outcome varies per op. */
  cookieOp?:
    | 'roundTrip2' // 2 entries → { ids }
    | 'tampered' // tampered value → { result } ([] on bad sig)
    | 'overflow' // 10 long entries → { bytes, parsedIds, expectedIds, parsedLen }
    | 'giant' // single >2048-byte entry → { bytes, parsedLen }
    | 'crossReplica'; // two createCookie instances, same secret → { count, firstId }

  // ── last-used-login cookie (fn: 'lastUsedLoginCheck') ──────────────────────
  /** serializeLastUsedLogin → parse round-trips + path scoping. outcome: { parsed } | { setCookie }. */
  lastUsedOp?: 'roundTripIdp' | 'absent' | 'roundTripEmail' | 'roundTripPasskey' | 'scopedToId';

  // ── passkey-hint cookie (fn: 'passkeyHintCheck') ───────────────────────────
  /** serializePasskeyHint → parse round-trips, clear, attribute pinning. outcome: { parsed } | { setCookie }. */
  passkeyHintOp?: 'roundTrip' | 'absent' | 'clear' | 'attrs';

  // ── reauth-intent cookie + shared identity guard (fn: 'reauthIntentCheck') ─
  /** serialize/read/clear/check. outcome: { value } | { cleared } | ReauthCheck. */
  reauthOp?:
    | 'roundTrip'
    | 'absent'
    | 'clear'
    | 'checkNoIntent'
    | 'checkMatch'
    | 'checkCaseInsensitive'
    | 'checkMismatch';

  // ── provider selection binding point (fn: 'selectProvider') ────────────────
  /** REAL select.server getAuthProvider / providerRegistry. outcome varies per op. */
  selectOp?:
    | 'fakeIsInstance' // getAuthProvider({fake}) instanceof FakeAuthProvider → { isFake }
    | 'zitadelNoThrow' // getAuthProvider({zitadel, serviceUrl}) constructs without throwing → { threw }
    | 'registryKeys' // Object.keys(providerRegistry).sort() → { keys }
    | 'fakeSingleton'; // providerRegistry.fake() x2 → { same }
}

/** A parsed logAuthEvent JSON line: { event, outcome, ...fields }. */
export interface AuditEvent {
  event: string;
  outcome: string;
  [field: string]: unknown;
}

/** A serialized Response (or react-router data() object) the *toResponse translators emit. */
export interface SerializedResponse {
  isResponse: boolean;
  status?: number;
  location?: string | null;
  setCookie?: string | null;
  /** Entries parsed back out of the `sessions` Set-Cookie (node-only HMAC round-trip). */
  cookieEntries?: Array<{ id: string }> | null;
  /** Every Set-Cookie header value (undici getSetCookie) — for multi-cookie responses. */
  setCookies?: string[];
  /** Parsed `last-used-login` token (e.g. `idp:<idpId>`), or null when absent. */
  lastUsedLogin?: string | null;
  /** Parsed value of a `passkey-hint` Set-Cookie on the response: the written loginName,
   *  '' when the response CLEARS the hint (empty value + Max-Age=0), null/absent when untouched. */
  passkeyHint?: string | null;
  /** Raw `fingerprintId` cookie value, or null when no fingerprintId Set-Cookie was emitted. */
  fingerprintId?: string | null;
  /** react-router data() object shape (non-Response path). */
  dataStatus?: number;
  dataBody?: unknown;
  /** Set-Cookie strings from a data() object's init.headers (loaders that both return data
   *  AND set cookies — e.g. /login's ceremony-session persist + hint clear). */
  dataSetCookies?: string[];
}

export interface Verdict {
  ok: boolean;
  error?: string;
  /** The service's typed return value, serialized (outcome object or EnrichedAccount[]). */
  outcome?: Record<string, unknown>;
  /** Present when the spec exercises a *toResponse translator. */
  response?: SerializedResponse;
  /** Parsed logAuthEvent JSON lines, in emission order. */
  audit: AuditEvent[];
  /** Raw audit JSON lines (for specs that parse them directly, mirroring the vitest console spy). */
  auditLines: string[];
  /** Recorded provider call args, keyed by method name. */
  calls?: Record<string, unknown[][]>;
  /** Provider state read back post-call (e.g. { isDeviceAuthorized: { 'dev-1': true } }). */
  inspect?: Record<string, unknown>;
}
