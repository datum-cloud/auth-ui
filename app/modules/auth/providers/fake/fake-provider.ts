import type {
  AuthProvider,
  RegisterInput,
  RegisterResult,
  SessionChecks,
  SessionOpts,
} from '@/modules/auth/auth-provider';
import type {
  AuthMethod,
  AuthRequest,
  BrandingTheme,
  DeviceAuthRequest,
  Factors,
  IdProvider,
  IdpIntentResult,
  IdpLink,
  LdapIntent,
  LoginSettings,
  PasswordComplexity,
  ProviderCapabilities,
  ProviderErrorCode,
  SamlResponse,
  Session,
  U2FCreationOptions,
  User,
  WebAuthnCreationOptions,
} from '@/modules/auth/types';
import { ProviderError } from '@/modules/auth/types';

// value import — never `import type`; instanceof checks require the runtime class

// Fake-only test-control script for getSession/createCallback (NOT on the AuthProvider
// interface). Lets a unit test force a specific outcome per session id without reaching the
// provider boundary — used by authorize.logout.test.ts to drive the validate-before-reuse
// dead/transient/live cases through the real loader. Default (no override) = real fake behaviour.
//
// 'throw-once' additionally drives the read-after-write retry tests (healIfSessionDead): the
// FIRST getSession call for that id throws the scripted code, then the script is CONSUMED (the
// entry is deleted) so every subsequent call falls through to the real in-memory session lookup
// — i.e. "fail once, then behave normally," which is exactly what a transient replica-lag 404
// followed by a successful retry looks like.
//
// 'throw-times' generalises that to N consecutive throws before falling through — it drives the
// BOUNDED-backoff-loop test (a replica that lags more than one read cycle), proving the retry
// keeps polling past the first attempt rather than giving up after one.
type FakeOutcomeScript =
  | { mode: 'null' }
  | { mode: 'throw'; code: ProviderErrorCode }
  | { mode: 'throw-once'; code: ProviderErrorCode }
  | { mode: 'throw-times'; code: ProviderErrorCode; times: number };

export const FIXED_NOW = '2026-01-01T00:00:00.000Z'; // deterministic for tests (no Date.now())
// Factor verifiedAt is `Date | null`. A frozen Date keeps the fake deterministic.
const FIXED_NOW_DATE = new Date(FIXED_NOW);
const FAR_FUTURE = '2099-01-01T00:00:00.000Z'; // fake sessions never expire (a past expiresAt would trip expiry checks)
// Base settings keep mfaInitSkipLifetimeMs at 0 (skip-prompt branch
// disabled) — a non-zero default would route EVERY no-2nd-factor login to /setup/mfa
// and break the non-MFA specs. Specs that need the skip-prompt branch seed a
// per-org override via settingsByOrg. Avoid finite windows against FIXED_NOW
// stamps: the route layer compares real Date.now(), so they rot into time bombs.

interface DeviceAuthSeed {
  userCode: string;
  id: string;
  appName?: string;
  scope: string[];
}

interface SamlRequestSeed {
  id: string;
  clientId: string;
  binding: 'redirect' | 'post';
}

interface LdapUserSeed {
  username: string;
  password: string;
  userId: string;
}

interface Seed {
  /**
   * Rotate the session token on every updateSession, as real Zitadel does. Off by default because
   * the suite was written against a non-rotating fake. Opt in to exercise a caller that persists
   * the PRE-update token and leaves the browser holding a stale one.
   */
  rotateSessionTokens?: boolean;
  /**
   * Seeded users. Together with `authMethods` these express the three account states the
   * G7 enumeration suite must distinguish:
   *   • fresh               — email absent from this list
   *   • existing verified   — present, and listed in `authMethods` (a real account)
   *   • existing unverified — present, `authMethods` empty (the factorless squatter)
   * register() throws ALREADY_EXISTS for the latter two, identically.
   */
  users?: User[];
  passwords?: Record<string, string>; // userId → plaintext password
  authMethods?: Record<string, AuthMethod[]>; // userId → list of methods
  authRequests?: Record<string, AuthRequest>; // requestId → AuthRequest
  idps?: IdProvider[]; // P4: active IdPs seeded for tests
  idpIntents?: Record<string, IdpIntentResult>; // P4: pre-seeded intent results keyed by intentId
  settingsByOrg?: Record<string, Partial<LoginSettings>>; // P5: per-org setting overrides (e.g. forceMfa)
  orgDomains?: Record<string, string>; // P2 domain discovery: email domain → orgId
  /**
   * Instance Default Organization id returned by getDefaultOrg (the org-first / default-org
   * fallback). Defaults to a stable fake id ('org-default-fake'); seed `null` to exercise the
   * "no default org → INSTANCE/default context" last-resort branch.
   */
  defaultOrgId?: string | null;

  deviceAuths?: DeviceAuthSeed[]; // P6: device authorization requests keyed by userCode
  samlRequests?: SamlRequestSeed[]; // P6: SAML auth requests
  ldapUsers?: LdapUserSeed[]; // P6: LDAP credential fixtures

  /**
   * The password-complexity policy getPasswordComplexity returns. Configurable so tests can drive
   * the policy-driven password rules (e.g. requiresSymbol=true). Defaults to min 8 / no required
   * character classes — the legacy behaviour the forms assumed before the policy was wired in.
   */
  passwordComplexity?: PasswordComplexity;

  /**
   * Override the provider's static capability flags. Partial — only provided keys are overridden;
   * unspecified keys keep their class defaults. Use in tests to simulate an instance that offers
   * no MFA enrollment methods (e.g. all MFA caps false → resolveMfaSetup auto-skip path).
   */
  capabilities?: Partial<ProviderCapabilities>;

  /** Pre-seeded passkey inventory (userId → rows) for /id/passkeys e2e fixtures. */
  passkeys?: Record<
    string,
    Array<{ id: string; state: 'active' | 'inactive'; name: string; createdAt?: string }>
  >;
  /** Pre-linked IdP identities (userId → links) — a constructor-time convenience for the
   *  same data setIdpLinks/addIdpLink set post-construction. */
  idpLinks?: Record<string, IdpLink[]>;
  /**
   * Stamp factor verifiedAt with REAL Date (new Date()) instead of FIXED_NOW_DATE.
   * Sudo freshness compares against real Date.now() at the route layer, so the e2e singleton
   * MUST set this or every session is permanently sudo-stale (the FIXED_NOW time bomb).
   * Component tests keep determinism by not setting it.
   */
  realFactorTimestamps?: boolean;
}

export class FakeAuthProvider implements AuthProvider {
  readonly capabilities: ProviderCapabilities = {
    passkey: true,
    u2f: false,
    totpOtp: true,
    emailOtp: true,
    smsOtp: false,
    externalIdp: true,
    ldap: true,
    saml: true,
    oidc: true,
    registration: true,
  };

  private users: User[];
  private passwords: Record<string, string>;
  private authMethods: Record<string, AuthMethod[]>;
  private authRequests: Record<string, AuthRequest>;
  private sessions = new Map<string, Session>();
  private emailVerified = new Map<string, boolean>();
  private emailCodes = new Map<string, string>();
  private resetCodes = new Map<string, string>();
  private idps: IdProvider[]; // P4
  private idpIntents: Record<string, IdpIntentResult>; // P4
  private idpLinks = new Map<string, IdpLink[]>(); // P4: userId → links
  private settingsByOrg: Record<string, Partial<LoginSettings>>; // P5: per-org overrides
  private orgDomains: Record<string, string>; // P2 domain discovery: email domain → orgId
  private defaultOrgId: string | null; // instance Default Organization (org-first fallback)
  private enrolled = new Map<string, Set<AuthMethod>>(); // P5: dynamically enrolled methods (merged with seeded authMethods)
  private passkeys = new Map<
    string,
    Array<{ id: string; state: 'active' | 'inactive'; name: string; createdAt?: string }>
  >();
  private realFactorTimestamps = false; // see Seed.realFactorTimestamps
  private mfaSkippedAt = new Map<string, string>(); // P5: userId → ISO timestamp of last skip
  private issuedOtpEmailCodes = new Map<string, string>(); // sessionId → returnCode issued for that session
  private deviceAuthSeeds: DeviceAuthSeed[]; // P6
  private samlRequestSeeds: SamlRequestSeed[]; // P6
  private ldapUserSeeds: LdapUserSeed[]; // P6
  private passwordComplexity: PasswordComplexity; // configurable complexity policy fixture
  private authorizedDevices = new Set<string>(); // P6: deviceAuthId → authorized
  // Fake-only: per-session outcome scripts for getSession/createCallback (see FakeOutcomeScript).
  private sessionResults = new Map<string, FakeOutcomeScript>();
  private callbackResults = new Map<string, FakeOutcomeScript>();
  private instanceAdminSessionId: string | null = null;
  private loginDefaultRedirectUri: string | undefined = undefined;
  // P2 domain discovery: BASE allowDomainDiscovery toggle. The base/instance settings
  // (getLoginSettings(undefined)) govern whether resolveIdentifier runs discovery, so the
  // ON test flips THIS, not a settingsByOrg key (which is never consulted for an empty orgId).
  private allowDomainDiscovery = false;
  private seq = 0;
  /** Last opts passed to createSession — test-only, lets specs assert userId + metadata. */
  lastCreateSessionOpts: SessionOpts | undefined;

  /** See Seed.rotateSessionTokens. */
  private readonly rotateSessionTokens: boolean;
  /** Monotonic suffix so each rotated token is distinct and traceable in a failure message. */
  private sessionTokenRotations = 0;

  constructor(seed: Seed = {}) {
    this.rotateSessionTokens = seed.rotateSessionTokens ?? false;
    this.users = seed.users ?? [];
    // e2e fixture: each SEEDED user gets a deterministic pending email code (`email-<id>`),
    // so the verify-and-advance journey works without the `?send=true` dispatch — which is
    // now session-gated server-side and a no-op for an unauthenticated visit.
    // Registered users (via register()) get their code set there instead; this only covers
    // the constructor seed.
    for (const u of this.users) this.emailCodes.set(u.id, `email-${u.id}`);
    this.passwords = seed.passwords ?? {};
    this.authMethods = seed.authMethods ?? {};
    this.authRequests = seed.authRequests ?? {};
    this.idps = seed.idps ?? []; // P4
    this.idpIntents = seed.idpIntents ?? {}; // P4
    this.settingsByOrg = seed.settingsByOrg ?? {}; // P5
    this.orgDomains = seed.orgDomains ?? {}; // P2 domain discovery
    // Stable fake default org unless the seed pins one (or `null` for the no-default branch).
    this.defaultOrgId = seed.defaultOrgId !== undefined ? seed.defaultOrgId : 'org-default-fake';
    this.deviceAuthSeeds = seed.deviceAuths ?? []; // P6
    this.samlRequestSeeds = seed.samlRequests ?? []; // P6
    this.ldapUserSeeds = seed.ldapUsers ?? []; // P6
    // Apply any capability overrides from the seed (partial merge over class defaults).
    if (seed.capabilities) {
      Object.assign(this.capabilities, seed.capabilities);
    }
    // Passkey inventory seed + real-time factor stamps flag.
    for (const [uid, list] of Object.entries(seed.passkeys ?? {}))
      this.passkeys.set(uid, [...list]);
    for (const [uid, links] of Object.entries(seed.idpLinks ?? {}))
      this.idpLinks.set(uid, [...links]);
    this.realFactorTimestamps = seed.realFactorTimestamps ?? false;
    this.passwordComplexity = seed.passwordComplexity ?? {
      minLength: 8,
      requiresUppercase: false,
      requiresLowercase: false,
      requiresNumber: false,
      requiresSymbol: false,
    };
  }

  // ─── settings ────────────────────────────────────────────────────────────────

  async getLoginSettings(orgId?: string): Promise<LoginSettings> {
    const base: LoginSettings = {
      allowPassword: true,
      allowRegister: true,
      allowExternalIdp: true,
      passkeysType: 'allowed',
      forceMfa: false,
      // explicit lifetimes so the fixture is complete for the Phase 1/4 expired-lifetime branch (0 = never expires)
      passwordCheckLifetimeMs: 0,
      secondFactorCheckLifetimeMs: 0,
      multiFactorCheckLifetimeMs: 0,
      // 0 = skippable-prompt branch disabled; password-only users go straight to /signed-in.
      // Specs that need the prompt visit /setup/mfa directly (setup-passkey-mfa.cy.ts).
      mfaInitSkipLifetimeMs: 0,
      defaultRedirectUri: this.loginDefaultRedirectUri,
      hidePasswordReset: false,
      ignoreUnknownUsernames: false,
      disableLoginWithEmail: false,
      disableLoginWithPhone: false,
      allowDomainDiscovery: this.allowDomainDiscovery,
    };
    // Merge per-org overrides when present (P5: allows forceMfa=true per org in e2e seeds).
    const override = orgId ? (this.settingsByOrg[orgId] ?? {}) : {};
    return { ...base, ...override };
  }

  async getBranding(_orgId?: string): Promise<BrandingTheme> {
    return { primaryColor: '#5469d4', hideLoginNameSuffix: false };
  }

  async getPasswordComplexity(_orgId?: string): Promise<PasswordComplexity | undefined> {
    // Returns the configurable fixture (seed.passwordComplexity), defaulting to min 8 / no classes.
    return this.passwordComplexity;
  }

  // getLegalSupport removed from the port (zero callers) — dropped here too.

  async getActiveIdPs(_orgId?: string): Promise<IdProvider[]> {
    return this.idps;
  }

  async getDefaultOrg(): Promise<string | null> {
    return this.defaultOrgId;
  }

  // ─── users ────────────────────────────────────────────────────────────────────

  async findUser(identifier: string, _orgId?: string): Promise<User | null> {
    const u = this.users.find((u) => u.loginName === identifier) ?? null;
    if (!u) return null;
    const skippedAt = this.mfaSkippedAt.get(u.id) ?? null;
    return skippedAt !== null ? { ...u, mfaInitSkippedAt: skippedAt } : u;
  }

  async findOrgByDomain(domain: string): Promise<{ orgId: string } | null> {
    const orgId = this.orgDomains[domain];
    return orgId ? { orgId } : null;
  }

  async getUser(id: string): Promise<User | null> {
    const u = this.users.find((u) => u.id === id) ?? null;
    if (!u) return null;
    const skippedAt = this.mfaSkippedAt.get(id) ?? null;
    return skippedAt !== null ? { ...u, mfaInitSkippedAt: skippedAt } : u;
  }

  async listAuthMethods(userId: string): Promise<AuthMethod[]> {
    // P5: merge seeded methods (authMethods seed) with dynamically enrolled methods
    const seeded = new Set<AuthMethod>(this.authMethods[userId] ?? []);
    const dynamic = this.enrolled.get(userId) ?? new Set<AuthMethod>();
    return [...new Set<AuthMethod>([...seeded, ...dynamic])];
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    // Zitadel rejects a duplicate login name with ALREADY_EXISTS, and the whole
    // enumeration-safe register flow (runEnumerationSafeRegister) is built around catching
    // exactly that code. Without this, no Cypress test can reach the duplicate branch — which
    // is the branch G7 exists to protect. Case-insensitive: Zitadel login names are.
    const taken = this.users.some((u) => u.loginName.toLowerCase() === input.email.toLowerCase());
    if (taken) throw new ProviderError('ALREADY_EXISTS', 'login name already taken');

    const id = `user-${++this.seq}`;
    const user: User = {
      id,
      loginName: input.email,
      displayName: `${input.firstName} ${input.lastName}`,
      orgId: input.orgId,
    };
    this.users = [...this.users, user];
    // When emailVerified:true the user is created already-verified (IdP register path).
    this.emailVerified.set(id, input.emailVerified === true);
    const code = `email-${id}`;
    this.emailCodes.set(id, code);
    // Mirrors the zitadel provider's toRegisterRequest priority (emailVerified > returnCode
    // > verifyUrlTemplate > plain): emailCode is surfaced only for the returnCode path, never
    // when emailVerified short-circuits it.
    return input.returnCode && !input.emailVerified ? { ...user, emailCode: code } : user;
  }

  // ─── password ────────────────────────────────────────────────────────────────

  async sendPasswordReset(userId: string, _urlTemplate: string): Promise<void> {
    this.resetCodes.set(userId, `reset-${userId}`);
  }

  async setPasswordWithCode(userId: string, code: string, _password: string): Promise<void> {
    if (this.resetCodes.get(userId) !== code)
      throw new ProviderError('INVALID_CREDENTIALS', 'bad reset code');
    this.resetCodes.delete(userId);
  }

  async changePasswordWithSession(
    sessionId: string,
    token: string,
    _password: string
  ): Promise<void> {
    if (!(await this.getSession(sessionId, token)))
      throw new ProviderError('INVALID_CREDENTIALS', 'bad session');
  }

  // ─── verification ────────────────────────────────────────────────────────────

  async sendEmailCode(userId: string, _urlTemplate: string): Promise<void> {
    this.emailCodes.set(userId, `email-${userId}`);
  }

  async verifyEmail(userId: string, code: string): Promise<void> {
    if (this.emailCodes.get(userId) !== code)
      throw new ProviderError('INVALID_CREDENTIALS', 'bad email code');
    this.emailVerified.set(userId, true);
  }

  async verifyInvite(userId: string, code: string): Promise<void> {
    return this.verifyEmail(userId, code);
  }

  async resendEmailCodeWithUrl(userId: string, _urlTemplate: string): Promise<void> {
    if (this.emailVerified.get(userId)) throw new ProviderError('ALREADY_DONE', 'already verified');
    this.emailCodes.set(userId, `email-resend-${userId}`);
  }

  async resendEmailCode(userId: string): Promise<string> {
    if (this.emailVerified.get(userId)) throw new ProviderError('ALREADY_DONE', 'already verified');
    const code = `email-resend-${userId}`;
    this.emailCodes.set(userId, code);
    return code;
  }

  async markEmailVerified(userId: string): Promise<void> {
    // Two-step: generate a code then verify it (mirrors the Zitadel returnCode impl).
    // In the fake we can do this directly — observable via isEmailVerified().
    this.emailVerified.set(userId, true);
  }

  // ─── fake-only inspection helpers (not on AuthProvider interface) ─────────────

  isEmailVerified(userId: string): boolean {
    return this.emailVerified.get(userId) ?? false;
  }
  lastEmailCode(userId: string): string | undefined {
    return this.emailCodes.get(userId);
  }
  lastResetCode(userId: string): string | undefined {
    return this.resetCodes.get(userId);
  }

  // ─── session ─────────────────────────────────────────────────────────────────

  // Factor verifiedAt stamp — real Date under realFactorTimestamps (e2e sudo
  // freshness), frozen FIXED_NOW_DATE otherwise (component-test determinism).
  private stamp(): Date {
    return this.realFactorTimestamps ? new Date() : FIXED_NOW_DATE;
  }

  async createSession(checks: SessionChecks, opts?: SessionOpts): Promise<Session> {
    const id = `sess-${++this.seq}`;
    this.lastCreateSessionOpts = opts;

    // P4: resolve idpIntent from seeded intents; prefer intent's userId over opts.userId
    const intent = checks.idpIntent ? this.idpIntents[checks.idpIntent.idpIntentId] : undefined;
    const boundUserId = intent?.userId ?? opts?.userId ?? null;

    const user = boundUserId
      ? (this.users.find((u) => u.id === boundUserId) ?? undefined)
      : undefined;

    const session: Session = {
      id,
      token: `tok-${id}`,
      user,
      // FIDELITY NOTE: any truthy password is accepted here WITHOUT consulting this.passwords —
      // the real adapter validates at createSession too. Phase 1's /login never passes one
      // (it uses updateSession for the credential check); add a passwords-map lookup if a
      // later phase starts calling createSession({ password }) as a real check.
      // P4: merge factors so a prior password factor survives an idpIntent createSession.
      factors: {
        password: { verifiedAt: checks.password ? this.stamp() : null },
        idpIntent: { verifiedAt: checks.idpIntent ? this.stamp() : null },
      },
      expiresAt: FAR_FUTURE, // far-future so fake sessions never trip expiry checks (MERGE RULE 1)
      changedAt: FIXED_NOW,
    };
    this.sessions.set(id, session);
    return session;
  }

  async getSession(id: string, token: string): Promise<Session | null> {
    // Fake-only test script (additive; absent ⇒ real behaviour below).
    const scripted = this.sessionResults.get(id);
    if (scripted) {
      if (scripted.mode === 'null') return null;
      if (scripted.mode === 'throw-once') {
        // Consume the script BEFORE throwing so every later call (the retry, or any call after
        // it) falls through to the real lookup below instead of throwing again.
        this.sessionResults.delete(id);
        throw new ProviderError(scripted.code, `scripted getSession ${scripted.code} (once)`);
      }
      if (scripted.mode === 'throw-times') {
        // Throw for the next `times` calls, decrementing each time; on the last one consume the
        // script so the following call falls through to the real lookup. Immutable update: re-set
        // a decremented copy rather than mutating the stored script object.
        if (scripted.times <= 1) this.sessionResults.delete(id);
        else this.sessionResults.set(id, { ...scripted, times: scripted.times - 1 });
        throw new ProviderError(
          scripted.code,
          `scripted getSession ${scripted.code} (${scripted.times} left)`
        );
      }
      throw new ProviderError(scripted.code, `scripted getSession ${scripted.code}`);
    }
    const s = this.sessions.get(id);
    return s && s.token === token ? s : null;
  }

  async updateSession(id: string, token: string, checks: SessionChecks): Promise<Session> {
    const s = this.sessions.get(id);
    if (!s || s.token !== token) {
      throw new ProviderError('NOT_FOUND', 'Session not found');
    }

    // Zitadel issues a NEW session token on every update; a caller that keeps using the old one
    // gets NOT_FOUND. Opt-in (see Seed.rotateSessionTokens) so existing specs are unaffected.
    const nextToken = this.rotateSessionTokens
      ? `${s.token}-r${++this.sessionTokenRotations}`
      : s.token;
    let updated: Session = { ...s, token: nextToken, changedAt: FIXED_NOW };

    if (checks.password !== undefined) {
      // FIDELITY NOTE: real Zitadel checks the session's OWN user; the users[0] fallback exists
      // for single-user seeds (the locked wrong-password test creates a session without
      // metadata.userId). Multi-user fixtures MUST pass metadata.userId or the check silently
      // targets the first seeded user.
      const userId = (s.user ?? this.users[0])?.id;
      const expected = userId ? this.passwords[userId] : undefined;
      if (checks.password !== expected) {
        throw new ProviderError('INVALID_CREDENTIALS', 'Could not verify password', false, {
          failedAttempts: 1,
          maxAttempts: 5,
        });
      }
      updated = {
        ...updated,
        factors: {
          ...updated.factors,
          password: { verifiedAt: this.stamp() },
        },
      };
    }

    // P5: MFA factor merges — fake accepts any non-empty value for each check
    if (checks.totp !== undefined) {
      updated = {
        ...updated,
        factors: { ...updated.factors, totp: { verifiedAt: this.stamp() } },
      };
    }

    if (checks.otpEmail !== undefined) {
      if (checks.otpEmail === '') {
        // Empty code is a no-op (treated as invalid input); callers must use checks.challenges
        // to request a challenge. Keep this guard to avoid accidentally marking the factor verified.
      } else {
        // If a returnCode was issued for this session, validate against it; otherwise accept any non-empty code
        // (legacy / link-click path where the provider validates the code server-side via the email link).
        const issuedCode = this.issuedOtpEmailCodes.get(id);
        if (issuedCode !== undefined && checks.otpEmail !== issuedCode) {
          throw new ProviderError('INVALID_CREDENTIALS', 'OTP email code mismatch');
        }
        if (issuedCode !== undefined) {
          // Consume the code so it cannot be reused
          this.issuedOtpEmailCodes.delete(id);
        }
        updated = {
          ...updated,
          factors: { ...updated.factors, otpEmail: { verifiedAt: this.stamp() } },
        };
      }
    }

    if (checks.otpSms !== undefined) {
      if (checks.otpSms === '') {
        // Empty code is a no-op; callers must use checks.challenges to request a challenge.
      } else {
        updated = {
          ...updated,
          factors: { ...updated.factors, otpSms: { verifiedAt: this.stamp() } },
        };
      }
    }

    if (checks.webAuthN !== undefined) {
      // webAuthN assertion sets the passkey factor verified + userVerified=true
      updated = {
        ...updated,
        factors: {
          ...updated.factors,
          passkey: { verifiedAt: this.stamp(), userVerified: true },
        },
      };
    }

    if (checks.idpIntent !== undefined) {
      // Mirrors the password branch's fidelity note: real Zitadel checks the session's
      // OWN user; the users[0] fallback exists for single-user seeds. Multi-user
      // fixtures MUST pass metadata.userId (via createSession's opts.userId) or the
      // check silently targets the first seeded user.
      const sessionUserId = (s.user ?? this.users[0])?.id;
      const intent = this.idpIntents[checks.idpIntent.idpIntentId];
      if (!intent || intent.userId !== sessionUserId) {
        // Matches real Zitadel's actual code/message for this exact case (observed in
        // production logs) — NOT INVALID_CREDENTIALS, which performReauth's catch used to
        // assume and therefore let this case fall through uncaught.
        throw new ProviderError('FAILED_PRECONDITION', 'Intent meant for another user');
      }
      updated = {
        ...updated,
        factors: { ...updated.factors, idpIntent: { verifiedAt: this.stamp() } },
      };
    }

    // P5 — challenge requests: ride back on the returned session copy, NOT persisted.
    // Early return intentionally skips factor-check persistence when a challenge is requested;
    // no current caller combines challenge + factor checks in the same call, and Zitadel
    // would process both independently if they were combined.
    if (checks.challenges !== undefined) {
      const challengeResult: Session['challenges'] = {};
      if (checks.challenges.webAuthN !== undefined) {
        // Return a deterministic pre-baked assertion challenge for e2e/testing.
        challengeResult.webAuthN = {
          publicKeyCredentialRequestOptions: {
            publicKey: {
              challenge: 'ZmFrZS1jaGFsbGVuZ2U',
              allowCredentials: [],
            },
          },
        };
      }
      // otpEmail is the OtpEmailChallenge discriminated union. 'return-code' returns the
      // code in-band (not emailed — used by the passwordless signup flow); 'send'/'send-template'
      // request an emailed code (no in-band code surfaced).
      const otpEmailChallenge = checks.challenges.otpEmail;
      if (otpEmailChallenge) {
        if (otpEmailChallenge.kind === 'return-code') {
          const code = '123456';
          this.issuedOtpEmailCodes.set(id, code);
          challengeResult.otpEmailCode = code;
        }
        // 'send' / 'send-template' emit no in-band code; the fake has nothing further to surface.
      }
      if (checks.challenges.otpSms === true) {
        challengeResult.otpSms = {};
      }
      // Do NOT persist updated; return the ephemeral copy with challenges.
      return { ...updated, challenges: challengeResult };
    }

    this.sessions.set(id, updated);
    return updated;
  }

  async deleteSession(id: string, token: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s && s.token === token) {
      this.sessions.delete(id);
    }
  }

  // ─── external idp (P4) ───────────────────────────────────────────────────────

  async startIdpIntent(
    idpId: string,
    _urls: { success: string; failure: string }
  ): Promise<{ authUrl?: string; formData?: unknown }> {
    // Deterministic authUrl — Cypress can assert it contains the idpId (Task 11).
    return { authUrl: `https://idp.test/authorize?idp=${idpId}` };
  }

  async retrieveIdpIntent(idpIntentId: string, _token: string): Promise<IdpIntentResult> {
    // Return the neutral type; callers no longer need to cast.
    // The seed map stores IdpIntentResult directly; null is cast to satisfy the contract
    // (a missing intent is a caller error — real adapter would throw NOT_FOUND).
    return (this.idpIntents[idpIntentId] ?? null) as IdpIntentResult;
  }

  async listIdpLinks(userId: string): Promise<IdpLink[]> {
    return this.idpLinks.get(userId) ?? [];
  }

  async addIdpLink(userId: string, link: IdpLink): Promise<void> {
    // Link is now typed IdpLink directly — no cast needed.
    const list = this.idpLinks.get(userId) ?? [];
    // upsert by idpId — replace any existing link for the same IdP
    this.idpLinks.set(userId, [...list.filter((x) => x.idpId !== link.idpId), link]);
  }

  async removeIdpLink(userId: string, idpId: string, linkedUserId: string): Promise<void> {
    const list = this.idpLinks.get(userId) ?? [];
    this.idpLinks.set(
      userId,
      list.filter((x) => !(x.idpId === idpId && x.idpUserId === linkedUserId))
    );
  }

  // ─── mfa — passkey / u2f / totp / otp (P5) ──────────────────────────────────

  private enroll(userId: string, method: AuthMethod): void {
    const set = this.enrolled.get(userId) ?? new Set<AuthMethod>();
    set.add(method);
    this.enrolled.set(userId, set);
  }

  async passkeyRegisterLink(userId: string): Promise<{ code: string }> {
    return { code: `pkcode-${userId}` };
  }

  async registerPasskey(
    _userId: string,
    _code: string,
    _domain: string
  ): Promise<WebAuthnCreationOptions> {
    // code not validated in fake; real adapter enforces it
    return {
      passkeyId: `pk-${++this.seq}`,
      publicKeyCredentialCreationOptions: { publicKey: {} },
    };
  }

  async verifyPasskey(
    userId: string,
    passkeyId: string,
    _cred: unknown,
    passkeyName?: string
  ): Promise<void> {
    // Record the named inventory row (immutably); 'Passkey' mirrors the Zitadel
    // adapter's non-empty default (DEFAULT_PASSKEY_NAME in providers/zitadel/mfa.ts).
    this.passkeys.set(userId, [
      ...(this.passkeys.get(userId) ?? []),
      {
        id: passkeyId,
        state: 'active',
        name: passkeyName?.trim() || 'Passkey',
        // Mirrors the real adapter's created-at metadata join, surfaced here as a stamp.
        createdAt: new Date().toISOString(),
      },
    ]);
    this.enroll(userId, 'passkey');
  }

  // Passkey inventory mirror (listPasskeys/removePasskey port additions).
  async listPasskeys(
    userId: string
  ): Promise<
    Array<{ id: string; state: 'active' | 'inactive'; name: string; createdAt?: string }>
  > {
    return [...(this.passkeys.get(userId) ?? [])];
  }

  async removePasskey(userId: string, passkeyId: string): Promise<void> {
    // Removing an unknown id is a silent no-op (idempotent — mirrors the removal-race rule).
    const remaining = (this.passkeys.get(userId) ?? []).filter((p) => p.id !== passkeyId);
    this.passkeys.set(userId, remaining);
    if (remaining.length === 0) {
      // Un-enroll the method with the last passkey — via a NEW Set (never mutate the stored one).
      const set = new Set(this.enrolled.get(userId) ?? []);
      set.delete('passkey');
      this.enrolled.set(userId, set);
      // listAuthMethods unions this dynamic set with the SEEDED static authMethods entry —
      // without also clearing 'passkey' there, a test seeding both authMethods: ['passkey']
      // and a passkeys array would still report it enrolled after the last one is removed.
      if (this.authMethods[userId]) {
        this.authMethods = {
          ...this.authMethods,
          [userId]: this.authMethods[userId].filter((m) => m !== 'passkey'),
        };
      }
    }
  }

  async registerU2F(_userId: string, _domain: string): Promise<U2FCreationOptions> {
    return {
      u2fId: `u2f-${++this.seq}`,
      publicKeyCredentialCreationOptions: { publicKey: {} },
    };
  }

  async verifyU2F(userId: string, _cred: unknown): Promise<void> {
    this.enroll(userId, 'u2f');
  }

  async registerTotp(userId: string): Promise<{ uri: string; secret: string }> {
    return {
      uri: `otpauth://totp/fake:${userId}?secret=SECRET${userId}`,
      secret: `SECRET${userId}`,
    };
  }

  async verifyTotp(userId: string, _code: string): Promise<void> {
    // fake accepts any code; enroll the TOTP method for this user
    this.enroll(userId, 'totp');
  }

  async addOtpEmail(userId: string): Promise<void> {
    if (!this.emailVerified.get(userId)) {
      throw new ProviderError(
        'FAILED_PRECONDITION',
        'Email must be verified before enrolling OTP email'
      );
    }
    this.enroll(userId, 'otp_email');
  }

  async addOtpSms(userId: string): Promise<void> {
    this.enroll(userId, 'otp_sms');
  }

  async listSessions(ids: string[]): Promise<Session[]> {
    // Returned sessions have token: '' — tokens live only in the session cookie; mirrors real adapter (ListSessions RPC never returns tokens)
    return ids
      .map((id) => this.sessions.get(id))
      .filter((s): s is Session => s !== undefined)
      .map((s) => ({ ...s, token: '' }));
  }

  // Cross-device mirrors: search by the session's bound user; delete without a token.
  async listUserSessions(userId: string): Promise<Session[]> {
    // token '' mirrors the real adapter (the search RPC never returns tokens).
    return [...this.sessions.values()]
      .filter((s) => s.user?.id === userId)
      .map((s) => ({ ...s, token: '' }));
  }

  async deleteUserSession(sessionId: string): Promise<void> {
    // Privileged token-less delete; unknown id is a silent no-op (idempotent).
    this.sessions.delete(sessionId);
  }

  async setMfaInitSkipped(userId: string): Promise<void> {
    this.mfaSkippedAt.set(userId, FIXED_NOW);
  }

  // ─── protocol (oidc / saml) ──────────────────────────────────────────────────

  async getAuthRequest(kind: 'oidc' | 'saml', requestId: string): Promise<AuthRequest> {
    if (kind === 'saml') {
      const r = this.samlRequestSeeds.find((x) => x.id === requestId);
      if (!r) throw new ProviderError('NOT_FOUND', 'SAML request not found');
      return { id: r.id, clientId: r.clientId, scopes: [], prompt: [] };
    }
    const req = this.authRequests[requestId];
    if (!req) {
      throw new ProviderError('NOT_FOUND', 'Auth request not found');
    }
    return req;
  }

  async createCallback(
    authRequestId: string,
    session: { id: string; token: string }
  ): Promise<{ callbackUrl: string }> {
    // Fake-only test script (additive; absent ⇒ real behaviour below). Used to assert that a
    // genuine ALREADY_DONE on a CONFIRMED-LIVE session still surfaces as an error.
    const scripted = this.callbackResults.get(session.id);
    if (scripted && scripted.mode === 'throw') {
      throw new ProviderError(scripted.code, `scripted createCallback ${scripted.code}`);
    }
    return {
      callbackUrl: `https://client.acme.test/callback?code=fake_${authRequestId}_${session.id}`,
    };
  }

  // ─── admin routing ───────────────────────────────────────────────────────────

  async isInstanceAdmin(session: { id: string; token: string }): Promise<boolean> {
    return this.instanceAdminSessionId !== null && session.id === this.instanceAdminSessionId;
  }

  // ─── fake-only test-control hooks (NOT on the AuthProvider interface) ──────────────────────
  // Designate a session id as the instance admin (for isInstanceAdmin tests).
  setInstanceAdminSession(id: string | null): void {
    this.instanceAdminSessionId = id;
  }
  setLoginDefaultRedirectUri(uri: string | undefined): void {
    this.loginDefaultRedirectUri = uri;
  }
  // Override the active-IdP list getActiveIdPs returns (P4 seed default: seed.idps ?? []).
  setActiveIdPs(list: IdProvider[]): void {
    this.idps = list;
  }
  // Overwrite (not append) a user's linked-IdP rows — a deterministic seam for reauth/sso
  // specs that need a specific link set without going through addIdpLink's upsert-by-idpId.
  setIdpLinks(userId: string, links: IdpLink[]): void {
    this.idpLinks.set(userId, links);
  }
  // Override the instance Default Organization getDefaultOrg returns (null ⇒ no default org).
  setDefaultOrg(id: string | null): void {
    this.defaultOrgId = id;
  }
  // P2 domain discovery: flip the BASE allowDomainDiscovery flag (getLoginSettings(undefined)).
  // Mirrors setLoginDefaultRedirectUri — a deterministic seam for the resolveIdentifier ON test,
  // since the instance/base policy (not a per-org override) governs whether discovery runs.
  setAllowDomainDiscovery(on: boolean): void {
    this.allowDomainDiscovery = on;
  }
  // Script getSession's outcome for a session id (null ⇒ confirmed dead; throw ⇒ ProviderError).
  setSessionResult(id: string, result: FakeOutcomeScript): void {
    this.sessionResults.set(id, result);
  }
  clearSessionResult(id: string): void {
    this.sessionResults.delete(id);
  }
  // Script createCallback's outcome for a session id (throw ⇒ ProviderError).
  setCallbackResult(id: string, result: FakeOutcomeScript): void {
    this.callbackResults.set(id, result);
  }
  clearCallbackResult(id: string): void {
    this.callbackResults.delete(id);
  }
  // Seed a live session into the map so getSession(id, token) returns it (without createSession).
  seedLiveSession(entry: {
    id: string;
    token: string;
    user?: User;
    /** Factors to stamp verified. Defaults to ['password'] (a fully authenticated session);
     *  pass e.g. ['otpEmail'] to seed one that is alive but NOT primary-authenticated. */
    factorKinds?: Array<keyof Factors>;
  }): void {
    // stamp(): FIXED_NOW_DATE by default; a REAL Date under realFactorTimestamps so
    // seeded sessions pass the sudo-freshness gate in node-harness scenarios.
    const factors: Factors = {};
    for (const kind of entry.factorKinds ?? ['password']) {
      factors[kind] = { verifiedAt: this.stamp() };
    }
    this.sessions.set(entry.id, {
      id: entry.id,
      token: entry.token,
      user: entry.user,
      factors,
      expiresAt: FAR_FUTURE,
      changedAt: FIXED_NOW,
    });
  }
  removeLiveSession(id: string): void {
    this.sessions.delete(id);
  }

  // ─── device grant (P6) ───────────────────────────────────────────────────────

  async getDeviceAuth(userCode: string): Promise<DeviceAuthRequest> {
    const d = this.deviceAuthSeeds.find((x) => x.userCode === userCode);
    if (!d) throw new ProviderError('NOT_FOUND', 'device authorization request not found');
    return { id: d.id, appName: d.appName, scope: d.scope };
  }

  async authorizeDevice(
    deviceAuthId: string,
    decision: { session?: { id: string; token: string } }
  ): Promise<void> {
    const exists = this.deviceAuthSeeds.some((x) => x.id === deviceAuthId);
    if (!exists) throw new ProviderError('NOT_FOUND', 'device authorization request not found');
    if (decision.session) this.authorizedDevices.add(deviceAuthId);
  }

  /** Test helper — not on the AuthProvider interface. */
  isDeviceAuthorized(deviceAuthId: string): boolean {
    return this.authorizedDevices.has(deviceAuthId);
  }

  // ─── saml (P6) ────────────────────────────────────────────────────────────────

  async createSamlResponse(
    samlRequestId: string,
    _session: { id: string; token: string }
  ): Promise<SamlResponse> {
    const r = this.samlRequestSeeds.find((x) => x.id === samlRequestId);
    if (!r) throw new ProviderError('NOT_FOUND', 'SAML request not found');
    return r.binding === 'post'
      ? {
          url: 'https://sp.test/acs',
          binding: 'post',
          relayState: `rs-${r.id}`,
          samlResponse: `resp-${r.id}`,
        }
      : { url: `https://sp.test/acs?SAMLResponse=resp-${r.id}`, binding: 'redirect' };
  }

  // ─── ldap (P6) ────────────────────────────────────────────────────────────────

  async startLdapIntent(idpId: string, username: string, password: string): Promise<LdapIntent> {
    const u = this.ldapUserSeeds.find((x) => x.username === username && x.password === password);
    if (!u)
      throw new ProviderError(
        'INVALID_CREDENTIALS',
        'INVALID_CREDENTIALS: LDAP authentication failed'
      );
    // Only register a consumable intent when a linked Zitadel user exists.
    // An unlinked user produces a register-draft (userId='') — storing it under
    // 'ldap-int-' would create a phantom key that collides across all unlinked users.
    const discriminator = u.userId || u.username;
    if (u.userId) {
      this.idpIntents[`ldap-int-${discriminator}`] = {
        userId: u.userId,
        information: { idpId, idpUserId: `ldap-${u.username}`, idpUserName: u.username },
        draft: null,
      };
    }
    return {
      userId: u.userId,
      idpIntentId: `ldap-int-${discriminator}`,
      idpIntentToken: `ldap-tok-${discriminator}`,
    };
  }
}
