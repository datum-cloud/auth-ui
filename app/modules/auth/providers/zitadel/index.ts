import {
  normalizeError,
  toAuthMethods,
  toAuthRequest,
  toBranding,
  toChallengeRequest,
  toChecks,
  toDeviceAuthRequest,
  toIdProvider,
  toIdpIntentResult,
  toIdpLink,
  toIdpLinkRequest,
  toLoginSettings,
  toPasswordComplexity,
  toRegisterRequest,
  toSamlAuthRequest,
  toSamlResponse,
  toSession,
  toSessionChallenges,
  toSetPasswordWithCodeRequest,
  toUser,
} from './mappers';
import { TIMEOUTS } from './timeouts';
// value import — never `import type`; instanceof checks require the runtime class
import { createServiceClient, type TransportEnv } from './transport';
import type {
  AuthProvider,
  RegisterInput,
  SessionChecks,
  SessionOpts,
} from '@/modules/auth/auth-provider';
import type {
  AuthMethod,
  AuthRequest,
  BrandingTheme,
  DeviceAuthRequest,
  IdProvider,
  IdpIntentResult,
  IdpLink,
  LdapIntent,
  LoginSettings,
  ProviderCapabilities,
  SamlResponse,
  Session,
  User,
} from '@/modules/auth/types';
import { ProviderError } from '@/modules/auth/types';
import type { DescService } from '@bufbuild/protobuf';
import type { JsonObject } from '@bufbuild/protobuf';
import { create } from '@zitadel/client';
import { makeReqCtx } from '@zitadel/client/v2';
import { TextQueryMethod } from '@zitadel/proto/zitadel/object/v2/object_pb';
import {
  AuthorizeOrDenyDeviceAuthorizationRequestSchema,
  CreateCallbackRequestSchema,
  DenySchema,
  OIDCService,
  SessionSchema as OidcSessionSchema,
} from '@zitadel/proto/zitadel/oidc/v2/oidc_service_pb';
import {
  OrganizationService,
  ListOrganizationsRequestSchema,
} from '@zitadel/proto/zitadel/org/v2/org_service_pb';
import { SearchQuerySchema as OrgSearchQuerySchema } from '@zitadel/proto/zitadel/org/v2/query_pb';
import {
  CreateResponseRequestSchema,
  SAMLService,
  SessionSchema as SamlSessionSchema,
} from '@zitadel/proto/zitadel/saml/v2/saml_service_pb';
import { SearchQuerySchema as SessionSearchQuerySchema } from '@zitadel/proto/zitadel/session/v2/session_pb';
import {
  ChecksSchema,
  SessionService,
  ListSessionsRequestSchema,
} from '@zitadel/proto/zitadel/session/v2/session_service_pb';
import { SettingsService } from '@zitadel/proto/zitadel/settings/v2/settings_service_pb';
import { LDAPCredentialsSchema } from '@zitadel/proto/zitadel/user/v2/idp_pb';
import { IDPLinkSchema, RedirectURLsSchema } from '@zitadel/proto/zitadel/user/v2/idp_pb';
import { SearchQuerySchema } from '@zitadel/proto/zitadel/user/v2/query_pb';
import {
  UserService,
  AddHumanUserRequestSchema,
  AddIDPLinkRequestSchema,
  ListIDPLinksRequestSchema,
  RemoveIDPLinkRequestSchema,
  StartIdentityProviderIntentRequestSchema,
  RetrieveIdentityProviderIntentRequestSchema,
  PasswordResetRequestSchema,
  SetPasswordRequestSchema,
  SendEmailCodeRequestSchema,
  ResendEmailCodeRequestSchema,
  VerifyEmailRequestSchema,
  VerifyInviteCodeRequestSchema,
  // P5 — MFA / passkey / u2f / totp / otp schemas
  CreatePasskeyRegistrationLinkRequestSchema,
  RegisterPasskeyRequestSchema,
  VerifyPasskeyRegistrationRequestSchema,
  RegisterU2FRequestSchema,
  VerifyU2FRegistrationRequestSchema,
  RegisterTOTPRequestSchema,
  VerifyTOTPRegistrationRequestSchema,
  AddOTPSMSRequestSchema,
  AddOTPEmailRequestSchema,
  HumanMFAInitSkippedRequestSchema,
} from '@zitadel/proto/zitadel/user/v2/user_service_pb';

// CCD-8 / CODE-MAJ-01: bound any single RPC. Promise.race returns control to the handler
// on deadline; the underlying socket is best-effort and will be GC'd. Mapped to UNAVAILABLE
// so callers treat it like any transient backend failure.
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderError('UNAVAILABLE', 'Zitadel RPC timed out')), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export interface ZitadelOpts {
  serviceUrl: string;
  serviceToken: string;
  env?: TransportEnv;
}

// Zitadel rejects empty webauthn credential names (PasskeyName / TokenName must be 1–200
// runes; an empty value comes back as [invalid_argument]). Used when a route supplies no
// user-chosen label.
const DEFAULT_PASSKEY_NAME = 'Passkey';
const DEFAULT_SECURITY_KEY_NAME = 'Security key';

export class ZitadelAuthProvider implements AuthProvider {
  readonly capabilities: ProviderCapabilities = {
    passkey: true,
    u2f: true,
    totpOtp: true,
    emailOtp: true,
    smsOtp: true,
    externalIdp: true,
    ldap: true,
    saml: true,
    oidc: true,
    registration: true,
  };
  constructor(private opts: ZitadelOpts) {}

  private svc<T extends DescService>(service: Parameters<typeof createServiceClient<T>>[0]) {
    return createServiceClient<T>(
      service,
      this.opts.serviceToken,
      this.opts.serviceUrl,
      this.opts.env
    );
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await withDeadline(fn(), TIMEOUTS.GRPC_CALL_MS);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw normalizeError(error);
    }
  }

  // settings
  async getLoginSettings(orgId?: string): Promise<LoginSettings> {
    const settings = this.svc(SettingsService);
    return this.call(async () => {
      const resp = await settings.getLoginSettings({ ctx: makeReqCtx(orgId) }, {});
      return toLoginSettings((resp.settings ?? {}) as Record<string, unknown>);
    });
  }
  async getBranding(orgId?: string): Promise<BrandingTheme> {
    const settings = this.svc(SettingsService);
    return this.call(async () => {
      const resp = await settings.getBrandingSettings({ ctx: makeReqCtx(orgId) }, {});
      return toBranding((resp.settings ?? {}) as Record<string, unknown>);
    });
  }
  async getPasswordComplexity(orgId?: string): Promise<unknown> {
    const settings = this.svc(SettingsService);
    return this.call(async () => {
      const resp = await settings.getPasswordComplexitySettings({ ctx: makeReqCtx(orgId) });
      // resp.settings.minLength is uint64 → bigint; coerce to number so the result
      // is JSON-serialisable and safe for React rendering (P5 spec-review fix).
      return resp.settings ? toPasswordComplexity(resp.settings) : undefined;
    });
  }
  async getLegalSupport(orgId?: string): Promise<unknown> {
    const settings = this.svc(SettingsService);
    return this.call(async () => {
      const resp = await settings.getLegalAndSupportSettings({ ctx: makeReqCtx(orgId) }, {});
      return resp.settings;
    });
  }

  async getActiveIdPs(orgId?: string): Promise<IdProvider[]> {
    const settings = this.svc(SettingsService);
    return this.call(async () => {
      const resp = await settings.getActiveIdentityProviders({ ctx: makeReqCtx(orgId) });
      return (resp.identityProviders ?? []).map(toIdProvider);
    });
  }

  // users — mirror fork searchUsers loginName path (Phase 1: exact loginName; email/phone fallback is Phase 2+)
  async findUser(identifier: string, orgId?: string): Promise<User | null> {
    const users = this.svc(UserService);
    return this.call(async () => {
      const queries = [
        create(SearchQuerySchema, {
          query: {
            case: 'loginNameQuery',
            value: { loginName: identifier, method: TextQueryMethod.EQUALS },
          },
        }),
      ];
      if (orgId) {
        queries.push(
          create(SearchQuerySchema, {
            query: { case: 'organizationIdQuery', value: { organizationId: orgId } },
          })
        );
      }
      const resp = await users.listUsers({ queries });
      const r = resp.result ?? [];
      if (r.length !== 1) return null;
      return toUser(r[0]);
    });
  }
  async findOrgByDomain(domain: string): Promise<{ orgId: string } | null> {
    // Domain discovery (settings-gated, default-off). Resolve the org that claims an
    // email domain via OrganizationService.ListOrganizations with a domain-query filter.
    // Proto: zitadel.org.v2.OrganizationService.ListOrganizations
    //   request  ListOrganizationsRequest { queries: SearchQuery[] }
    //   filter   SearchQuery.query = { case: 'domainQuery', value: OrganizationDomainQuery }
    //   query    OrganizationDomainQuery { domain: string; method: TextQueryMethod }
    //   response ListOrganizationsResponse { result: Organization[] }  (Organization.id: string)
    // Unique-match only: 0 or >1 results resolve to null (no ambiguous routing).
    const orgs = this.svc(OrganizationService);
    return this.call(async () => {
      const req = create(ListOrganizationsRequestSchema, {
        queries: [
          create(OrgSearchQuerySchema, {
            query: {
              case: 'domainQuery',
              value: { domain, method: TextQueryMethod.EQUALS },
            },
          }),
        ],
      });
      const resp = await orgs.listOrganizations(req);
      const result = resp.result ?? [];
      if (result.length !== 1) return null;
      const orgId = result[0].id;
      return orgId ? { orgId } : null;
    });
  }
  async getUser(id: string): Promise<User | null> {
    const users = this.svc(UserService);
    return this.call(async () => {
      const resp = await users.getUserByID({ userId: id }, {});
      return resp.user ? toUser(resp.user) : null;
    });
  }
  async listAuthMethods(userId: string): Promise<AuthMethod[]> {
    const users = this.svc(UserService);
    return this.call(async () => {
      const resp = await users.listAuthenticationMethodTypes({ userId });
      return toAuthMethods(resp.authMethodTypes ?? []);
    });
  }
  async register(input: RegisterInput): Promise<User> {
    const users = this.svc(UserService);
    return this.call(async () => {
      const req = create(AddHumanUserRequestSchema, toRegisterRequest(input));
      const resp = await users.addHumanUser(req);
      return {
        id: resp.userId,
        loginName: input.email,
        displayName: `${input.firstName} ${input.lastName}`,
        orgId: resp.details?.resourceOwner,
      };
    });
  }

  // password

  async sendPasswordReset(userId: string, urlTemplate: string): Promise<void> {
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(PasswordResetRequestSchema, {
        userId,
        medium: {
          case: 'sendLink',
          value: { urlTemplate },
        },
      });
      await users.passwordReset(req);
    });
  }
  async setPasswordWithCode(userId: string, code: string, password: string): Promise<void> {
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(
        SetPasswordRequestSchema,
        toSetPasswordWithCodeRequest(userId, code, password)
      );
      await users.setPassword(req);
    });
  }
  async changePasswordWithSession(
    sessionId: string,
    token: string,
    password: string
  ): Promise<void> {
    // Self-service password change: the request must be authorised with the SESSION token,
    // not the service token, so the user's own identity is authenticated. We build a
    // UserService client carrying the session token (not this.opts.serviceToken).
    // Boundary note: this is the ONLY method that creates a session-token-authed client;
    // all other methods use the service (PAT) token via this.svc().
    const session = await this.getSession(sessionId, token);
    if (!session?.user?.id) {
      throw normalizeError({ code: 5, message: 'Session user not found' });
    }
    const sessionUsers = createServiceClient(
      UserService,
      token, // session token — self-service auth
      this.opts.serviceUrl,
      this.opts.env
    );
    await this.call(async () => {
      const req = create(SetPasswordRequestSchema, {
        userId: session.user!.id,
        newPassword: { password, changeRequired: false },
        // No verificationCode — self-service with a valid session token
        verification: { case: undefined },
      });
      await sessionUsers.setPassword(req);
    });
  }

  // verification

  async sendEmailCode(userId: string, urlTemplate: string): Promise<void> {
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(SendEmailCodeRequestSchema, {
        userId,
        verification: {
          case: 'sendCode',
          value: { urlTemplate },
        },
      });
      await users.sendEmailCode(req);
    });
  }
  async verifyEmail(userId: string, code: string): Promise<void> {
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(VerifyEmailRequestSchema, { userId, verificationCode: code });
      await users.verifyEmail(req);
    });
  }
  async verifyInvite(userId: string, code: string): Promise<void> {
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(VerifyInviteCodeRequestSchema, { userId, verificationCode: code });
      await users.verifyInviteCode(req);
    });
  }
  async resendEmailCode(userId: string, urlTemplate: string): Promise<void> {
    // For standard email verification resend: uses resendEmailCode RPC.
    // NOTE: if the user was created via an invite flow, re-sending the invite
    // requires the createInviteCode RPC instead (route-flagged — Phase 3+).
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(ResendEmailCodeRequestSchema, {
        userId,
        verification: {
          case: 'sendCode',
          value: { urlTemplate },
        },
      });
      await users.resendEmailCode(req);
    });
  }

  // session
  async createSession(checks: SessionChecks, opts?: SessionOpts): Promise<Session> {
    const sessions = this.svc(SessionService);
    return this.call(async () => {
      // Phase 1: user-only or user+password. User must be selected before createSession in the real flow;
      // /login resolves the user first via findUser, so we pass the userId via opts.userId.
      const userId = opts?.userId;
      const builtChecks = create(ChecksSchema, {
        ...(userId ? { user: { search: { case: 'userId', value: userId } } } : {}),
        // Use presence semantics (undefined check, not truthiness) so an empty-string password
        // is forwarded to Zitadel rather than silently dropped — let the server reject it.
        ...(checks.password !== undefined ? { password: { password: checks.password } } : {}),
        // IdP intent check: when the caller has an idpIntentId+Token from a completed OAuth flow,
        // pass it to Zitadel so the session is established via the IdP factor.
        ...(checks.idpIntent !== undefined
          ? {
              idpIntent: {
                idpIntentId: checks.idpIntent.idpIntentId,
                idpIntentToken: checks.idpIntent.idpIntentToken,
              },
            }
          : {}),
      });
      // Give the session an explicit lifetime so Zitadel returns an expirationDate. Without it the
      // session carries none → the mapper stores expiresAt='' → /accounts filters every entry as
      // "expired" (Number('')===0), leaving the multi-account picker permanently empty. 12h matches
      // the access-token window and stays well under typical instance session caps.
      const lifetimeSeconds = 12 * 60 * 60;
      // Forward REAL session metadata (e.g. the MaxMind device-tracking token under
      // 'maxmind/tracking-token'). The proto field is map<string, bytes>, so each
      // string value is TextEncoder-encoded to bytes. Omit the field entirely when
      // there is no metadata so we never send an empty map.
      const encoder = new TextEncoder();
      const metadata = opts?.metadata
        ? Object.fromEntries(Object.entries(opts.metadata).map(([k, v]) => [k, encoder.encode(v)]))
        : undefined;
      const created = await sessions.createSession(
        {
          checks: builtChecks,
          lifetime: { seconds: BigInt(lifetimeSeconds) },
          ...(metadata ? { metadata } : {}),
        },
        {}
      );
      const got = await sessions.getSession(
        { sessionId: created.sessionId, sessionToken: created.sessionToken },
        {}
      );
      if (!got.session) throw new Error('Could not load created session');
      return toSession(got.session, created.sessionToken);
    });
  }
  async getSession(id: string, token: string): Promise<Session | null> {
    const sessions = this.svc(SessionService);
    return this.call(async () => {
      const resp = await sessions.getSession({ sessionId: id, sessionToken: token }, {});
      return resp.session ? toSession(resp.session, token) : null;
    });
  }
  async updateSession(id: string, token: string, checks: SessionChecks): Promise<Session> {
    const sessions = this.svc(SessionService);
    return this.call(async () => {
      const mfaChecks = toChecks(checks);
      const built = create(ChecksSchema, {
        // Use presence semantics (undefined check, not truthiness) so an empty-string password
        // is forwarded to Zitadel rather than silently dropped — let the server reject it.
        ...(checks.password !== undefined ? { password: { password: checks.password } } : {}),
        // IdP intent check (P4)
        ...(checks.idpIntent !== undefined
          ? {
              idpIntent: {
                idpIntentId: checks.idpIntent.idpIntentId,
                idpIntentToken: checks.idpIntent.idpIntentToken,
              },
            }
          : {}),
        // P5 MFA checks: webAuthN / totp / otpSms / otpEmail
        ...(mfaChecks.webAuthN !== undefined ? { webAuthN: mfaChecks.webAuthN } : {}),
        ...(mfaChecks.totp !== undefined ? { totp: mfaChecks.totp } : {}),
        ...(mfaChecks.otpSms !== undefined ? { otpSms: mfaChecks.otpSms } : {}),
        ...(mfaChecks.otpEmail !== undefined ? { otpEmail: mfaChecks.otpEmail } : {}),
      });
      // P5: if the caller requests challenges, map them and include on the SetSession request.
      const challengeReq = checks.challenges ? toChallengeRequest(checks.challenges) : undefined;
      const updated = await sessions.setSession(
        {
          sessionId: id,
          sessionToken: token,
          checks: built,
          ...(challengeReq ? { challenges: challengeReq } : {}),
        },
        {}
      );
      const newToken = updated.sessionToken || token;
      const got = await sessions.getSession({ sessionId: id, sessionToken: newToken }, {});
      if (!got.session) throw new Error('Could not load updated session');
      const session = toSession(got.session, newToken);
      // Surface SetSessionResponse.challenges onto the returned session so routes can
      // drive the browser WebAuthn ceremony. The Session entity proto (GetSession path)
      // has no challenges field — only the SetSession response carries them live.
      return updated.challenges
        ? { ...session, challenges: toSessionChallenges(updated.challenges) }
        : session;
    });
  }
  async deleteSession(id: string, token: string): Promise<void> {
    const sessions = this.svc(SessionService);
    await this.call(() => sessions.deleteSession({ sessionId: id, sessionToken: token }, {}));
  }
  async listSessions(ids: string[]): Promise<Session[]> {
    const sessions = this.svc(SessionService);
    return this.call(async () => {
      const req = create(ListSessionsRequestSchema, {
        queries: [
          create(SessionSearchQuerySchema, {
            query: { case: 'idsQuery', value: { ids } },
          }),
        ],
      });
      const resp = await sessions.listSessions(req, {});
      // ListSessions RPC never returns session tokens — empty string is intentional;
      // these Session objects are read-only enrichment and cannot be used with updateSession/deleteSession.
      return (resp.sessions ?? []).map((s) => toSession(s, ''));
    });
  }

  // passkey / u2f / totp / otp ─ (P5)

  async passkeyRegisterLink(userId: string): Promise<{ code: string }> {
    const users = this.svc(UserService);
    return this.call(async () => {
      const req = create(CreatePasskeyRegistrationLinkRequestSchema, {
        userId,
        medium: { case: 'returnCode', value: {} },
      });
      const resp = await users.createPasskeyRegistrationLink(req, {});
      // PasskeyRegistrationCode { id: string; code: string } — round-trip both as JSON
      const c = resp.code;
      return { code: c ? JSON.stringify({ id: c.id, code: c.code }) : '' };
    });
  }

  async registerPasskey(userId: string, code: string, domain: string): Promise<unknown> {
    // P5 — returns raw credential creation options; adapter narrows, routes treat as opaque
    const users = this.svc(UserService);
    return this.call(async () => {
      // Decode the opaque code string produced by passkeyRegisterLink.
      let parsed: { id?: string; code?: string };
      try {
        parsed = JSON.parse(code) as { id?: string; code?: string };
      } catch {
        throw normalizeError({
          message:
            'malformed passkey registration code (expected JSON envelope from passkeyRegisterLink)',
        });
      }
      const req = create(RegisterPasskeyRequestSchema, {
        userId,
        domain,
        ...(parsed.id && parsed.code ? { code: { id: parsed.id, code: parsed.code } } : {}),
      });
      const resp = await users.registerPasskey(req, {});
      return {
        passkeyId: resp.passkeyId,
        publicKeyCredentialCreationOptions: resp.publicKeyCredentialCreationOptions,
      };
    });
  }

  async verifyPasskey(
    userId: string,
    passkeyId: string,
    cred: unknown,
    passkeyName?: string
  ): Promise<void> {
    // cred is the PublicKeyCredential JSON from the browser WebAuthn API (JsonObject).
    // Zitadel requires PasskeyName to be 1–200 runes — an empty value is rejected with
    // [invalid_argument] (surfaced to us as INVALID_CREDENTIALS). Routes may pass a
    // user-supplied label; otherwise fall back to a non-empty default.
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(VerifyPasskeyRegistrationRequestSchema, {
        userId,
        passkeyId,
        publicKeyCredential: cred as JsonObject,
        passkeyName: passkeyName?.trim() || DEFAULT_PASSKEY_NAME,
      });
      await users.verifyPasskeyRegistration(req, {});
    });
  }

  async registerU2F(userId: string, domain: string): Promise<unknown> {
    // P5 — returns raw credential creation options; adapter narrows, routes treat as opaque
    const users = this.svc(UserService);
    return this.call(async () => {
      const req = create(RegisterU2FRequestSchema, { userId, domain });
      const resp = await users.registerU2F(req, {});
      return {
        u2fId: resp.u2fId,
        publicKeyCredentialCreationOptions: resp.publicKeyCredentialCreationOptions,
      };
    });
  }

  async verifyU2F(userId: string, cred: unknown): Promise<void> {
    // cred must include { u2fId, publicKeyCredential, tokenName? } — supplied by the route
    // after the browser WebAuthn ceremony completes.
    const users = this.svc(UserService);
    await this.call(async () => {
      const c = cred as { u2fId?: string; publicKeyCredential?: unknown; tokenName?: string };
      const req = create(VerifyU2FRegistrationRequestSchema, {
        userId,
        u2fId: c.u2fId ?? '',
        publicKeyCredential: c.publicKeyCredential as JsonObject,
        // Zitadel requires TokenName 1–200 runes — fall back to a non-empty default.
        tokenName: c.tokenName?.trim() || DEFAULT_SECURITY_KEY_NAME,
      });
      await users.verifyU2FRegistration(req, {});
    });
  }

  async registerTotp(userId: string): Promise<{ uri: string; secret: string }> {
    const users = this.svc(UserService);
    return this.call(async () => {
      const req = create(RegisterTOTPRequestSchema, { userId });
      const resp = await users.registerTOTP(req, {});
      return { uri: resp.uri, secret: resp.secret };
    });
  }

  async verifyTotp(userId: string, code: string): Promise<void> {
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(VerifyTOTPRegistrationRequestSchema, { userId, code });
      await users.verifyTOTPRegistration(req, {});
    });
  }

  async addOtpEmail(userId: string): Promise<void> {
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(AddOTPEmailRequestSchema, { userId });
      await users.addOTPEmail(req, {});
    });
  }

  async addOtpSms(userId: string): Promise<void> {
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(AddOTPSMSRequestSchema, { userId });
      await users.addOTPSMS(req, {});
    });
  }

  async setMfaInitSkipped(userId: string): Promise<void> {
    // Proto RPC: UserService.HumanMFAInitSkipped (humanMFAInitSkipped on the generated client)
    // Request: HumanMFAInitSkippedRequest { userId: string }
    // Writes the skip timestamp on the human user, surfaced back as User.mfaInitSkippedAt via toUser().
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(HumanMFAInitSkippedRequestSchema, { userId });
      await users.humanMFAInitSkipped(req, {});
    });
  }

  // external idp (Phase 4)

  async startIdpIntent(
    idpId: string,
    urls: { success: string; failure: string }
  ): Promise<{ authUrl?: string; formData?: unknown }> {
    const users = this.svc(UserService);
    return this.call(async () => {
      const req = create(StartIdentityProviderIntentRequestSchema, {
        idpId,
        content: {
          case: 'urls',
          value: create(RedirectURLsSchema, {
            successUrl: urls.success,
            failureUrl: urls.failure,
          }),
        },
      });
      const resp = await users.startIdentityProviderIntent(req);
      // nextStep oneof: authUrl (OAuth/OIDC), idpIntent (LDAP/already-linked), formData (SAML Phase 6)
      if (resp.nextStep.case === 'authUrl') {
        return { authUrl: resp.nextStep.value };
      }
      if (resp.nextStep.case === 'formData') {
        return { formData: resp.nextStep.value };
      }
      // idpIntent case: LDAP or auto-completed — return empty (caller checks intent id)
      return {};
    });
  }

  async retrieveIdpIntent(idpIntentId: string, token: string): Promise<IdpIntentResult> {
    const users = this.svc(UserService);
    return this.call(async () => {
      const req = create(RetrieveIdentityProviderIntentRequestSchema, {
        idpIntentId,
        idpIntentToken: token,
      });
      const resp = await users.retrieveIdentityProviderIntent(req);
      return toIdpIntentResult(resp);
    });
  }

  async listIdpLinks(userId: string): Promise<IdpLink[]> {
    const users = this.svc(UserService);
    return this.call(async () => {
      const req = create(ListIDPLinksRequestSchema, { userId });
      const resp = await users.listIDPLinks(req);
      // CODE-MIN-03: map proto IDPLink entries to neutral IdpLink shape (field names differ).
      return (resp.result ?? []).map(toIdpLink);
    });
  }

  async addIdpLink(userId: string, link: IdpLink): Promise<void> {
    const users = this.svc(UserService);
    await this.call(async () => {
      const idpLink = create(IDPLinkSchema, toIdpLinkRequest(link));
      const req = create(AddIDPLinkRequestSchema, { userId, idpLink });
      await users.addIDPLink(req);
    });
  }

  async removeIdpLink(userId: string, idpId: string, linkedUserId: string): Promise<void> {
    const users = this.svc(UserService);
    await this.call(async () => {
      const req = create(RemoveIDPLinkRequestSchema, { userId, idpId, linkedUserId });
      await users.removeIDPLink(req);
    });
  }

  // protocol (oidc / saml) — 'saml' path implemented in Task 5
  async getAuthRequest(kind: 'oidc' | 'saml', requestId: string): Promise<AuthRequest> {
    if (kind === 'saml') {
      const saml = this.svc(SAMLService);
      return this.call(async () => {
        const { samlRequest } = await saml.getSAMLRequest({ samlRequestId: requestId });
        // empty id (proto3 default) is as good as missing — treat both as not found
        if (!samlRequest?.id) throw normalizeError({ code: 5, message: 'SAML request not found' });
        return toSamlAuthRequest(samlRequest);
      });
    }
    const oidc = this.svc(OIDCService);
    return this.call(async () => {
      const resp = await oidc.getAuthRequest({ authRequestId: requestId });
      if (!resp.authRequest) throw normalizeError({ code: 5, message: 'Auth request not found' });
      return toAuthRequest(resp.authRequest);
    });
  }
  async createCallback(
    authRequestId: string,
    session: { id: string; token: string }
  ): Promise<{ callbackUrl: string }> {
    const oidc = this.svc(OIDCService);
    return this.call(async () => {
      const req = create(CreateCallbackRequestSchema, {
        authRequestId,
        callbackKind: {
          case: 'session',
          value: create(OidcSessionSchema, { sessionId: session.id, sessionToken: session.token }),
        },
      });
      const resp = await oidc.createCallback(req);
      if (!resp.callbackUrl) throw normalizeError({ code: 5, message: 'Callback URL missing' });
      return { callbackUrl: resp.callbackUrl };
    });
  }

  // ─── device grant (P6 Task 5) ────────────────────────────────────────────────

  async getDeviceAuth(userCode: string): Promise<DeviceAuthRequest> {
    const oidc = this.svc(OIDCService);
    return this.call(async () => {
      const { deviceAuthorizationRequest } = await oidc.getDeviceAuthorizationRequest({ userCode });
      if (!deviceAuthorizationRequest)
        throw normalizeError({ code: 5, message: 'device authorization request not found' });
      return toDeviceAuthRequest(deviceAuthorizationRequest);
    });
  }

  async authorizeDevice(
    deviceAuthId: string,
    decision: { session?: { id: string; token: string } }
  ): Promise<void> {
    const oidc = this.svc(OIDCService);
    await this.call(async () => {
      const req = create(AuthorizeOrDenyDeviceAuthorizationRequestSchema, {
        deviceAuthorizationId: deviceAuthId,
        decision: decision.session
          ? {
              case: 'session',
              value: create(OidcSessionSchema, {
                sessionId: decision.session.id,
                sessionToken: decision.session.token,
              }),
            }
          : { case: 'deny', value: create(DenySchema, {}) },
      });
      await oidc.authorizeOrDenyDeviceAuthorization(req);
    });
  }

  // ─── saml (P6 Task 5) ────────────────────────────────────────────────────────

  async createSamlResponse(
    samlRequestId: string,
    session: { id: string; token: string }
  ): Promise<SamlResponse> {
    const saml = this.svc(SAMLService);
    return this.call(async () => {
      const resp = await saml.createResponse(
        create(CreateResponseRequestSchema, {
          samlRequestId,
          responseKind: {
            case: 'session',
            value: create(SamlSessionSchema, {
              sessionId: session.id,
              sessionToken: session.token,
            }),
          },
        })
      );
      return toSamlResponse({ url: resp.url, binding: resp.binding });
    });
  }

  // ─── admin routing ────────────────────────────────────────────────────────────

  async isInstanceAdmin(session: { id: string; token: string }): Promise<boolean> {
    try {
      const res = await fetch(`${this.opts.serviceUrl}/auth/v1/memberships/me/_search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: '{}',
        // CCD-8 / CODE-MAJ-01: bound the admin check so a hung Zitadel cannot stall the
        // /signed-in loader. AbortError is swallowed by the existing catch → fail-open false.
        signal: AbortSignal.timeout(TIMEOUTS.ADMIN_CHECK_MS),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { result?: Array<{ iam?: boolean; roles?: string[] }> };
      return (data.result ?? []).some(
        (m) => m.iam === true || (m.roles ?? []).some((r) => r.startsWith('IAM_'))
      );
    } catch {
      return false;
    }
  }

  // ─── ldap (P6 Task 5) ────────────────────────────────────────────────────────

  async startLdapIntent(idpId: string, username: string, password: string): Promise<LdapIntent> {
    const users = this.svc(UserService);
    return this.call(async () => {
      const req = create(StartIdentityProviderIntentRequestSchema, {
        idpId,
        content: {
          case: 'ldap',
          value: create(LDAPCredentialsSchema, { username, password }),
        },
      });
      const resp = await users.startIdentityProviderIntent(req);
      if (resp.nextStep.case !== 'idpIntent' || !resp.nextStep.value) {
        throw new ProviderError('INVALID_CREDENTIALS', 'LDAP authentication failed');
      }
      const { idpIntentId, idpIntentToken, userId } = resp.nextStep.value;
      return { userId, idpIntentId, idpIntentToken };
    });
  }
}
