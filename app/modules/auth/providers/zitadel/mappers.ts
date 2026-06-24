import type { RegisterInput, SessionChecks } from '@/modules/auth/auth-provider';
import {
  ProviderError,
  type AuthMethod,
  type AuthRequest,
  type BrandingTheme,
  type DeviceAuthRequest,
  type IdProvider,
  type IdpInformation,
  type IdpIntentResult,
  type IdpLink,
  type IdpUserDraft,
  type LoginSettings,
  type PasswordComplexity,
  type ProviderErrorCode,
  type SamlResponse,
  type Session,
  type SessionChallenges,
  type User,
} from '@/modules/auth/types';
import type { JsonObject } from '@bufbuild/protobuf';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import type { Timestamp } from '@bufbuild/protobuf/wkt';
import { UserVerificationRequirement } from '@zitadel/proto/zitadel/session/v2/challenge_pb';

// gRPC status code → ProviderError code
const GRPC_CODE: Record<number, ProviderErrorCode> = {
  3: 'INVALID_CREDENTIALS', // INVALID_ARGUMENT (credentials check)
  4: 'DEADLINE_EXCEEDED',
  5: 'NOT_FOUND',
  7: 'PERMISSION_DENIED',
  8: 'RATE_LIMITED', // RESOURCE_EXHAUSTED
  14: 'UNAVAILABLE',
};

interface ConnectErrorLike {
  code?: number;
  message?: string;
  findDetails?: (schema?: unknown) => unknown[];
}

// Message-discriminated mappings run BEFORE the generic GRPC_CODE lookup so that
// shared codes can be specialised by message content. Ordering matters:
//   1. failedAttempts detail → INVALID_CREDENTIALS (P1 behaviour, unchanged)
//   2. code 3 + /complexity/i → PASSWORD_COMPLEXITY (P2)
//   3. code 6 → ALREADY_EXISTS (P2; AlreadyExists not in P1 GRPC_CODE map)
//   4. code 9 + /verified|already/i → ALREADY_DONE (P2; FailedPrecondition)
//   5. fall through to GRPC_CODE table (preserves all P1 behaviour)
export function normalizeError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const e = error as ConnectErrorLike;
  const failed = extractFailedAttempts(e);
  if (failed != null) {
    return new ProviderError(
      'INVALID_CREDENTIALS',
      e?.message ?? 'Unexpected provider error',
      false,
      {
        failedAttempts: failed,
      }
    );
  }
  const numCode = typeof e?.code === 'number' ? e.code : undefined;
  const msg = e?.message ?? '';
  let code: ProviderErrorCode;
  if (numCode === 3 && /complexity/i.test(msg)) {
    code = 'PASSWORD_COMPLEXITY';
  } else if (numCode === 6) {
    code = 'ALREADY_EXISTS';
  } else if (numCode === 9 && /verified|already/i.test(msg)) {
    code = 'ALREADY_DONE';
  } else if (numCode === 9) {
    // A FailedPrecondition that isn't "already/verified" is still a distinct,
    // meaningful state (e.g. precondition not met) — don't collapse it into UNKNOWN.
    code = 'FAILED_PRECONDITION';
  } else {
    code = (numCode !== undefined ? GRPC_CODE[numCode] : undefined) ?? 'UNKNOWN';
  }
  const retriable = code === 'UNAVAILABLE' || code === 'DEADLINE_EXCEEDED';
  return new ProviderError(code, msg || 'Unexpected provider error', retriable);
}

function extractFailedAttempts(e: ConnectErrorLike): number | undefined {
  try {
    const details = e.findDetails?.() ?? [];
    for (const d of details) {
      if (d && typeof d === 'object' && 'failedAttempts' in d) {
        const v = (d as { failedAttempts: unknown }).failedAttempts;
        if (typeof v === 'number') return v;
        if (typeof v === 'bigint') return Number(v);
      }
    }
  } catch {
    /* ignore — best-effort detail extraction */
  }
  return undefined;
}

// Prompt enum (mirror @zitadel/proto oidc/v2 authorization_pb Prompt):
// 0=UNSPECIFIED, 1=NONE, 2=LOGIN, 3=CONSENT, 4=SELECT_ACCOUNT, 5=CREATE
const PROMPT: Record<number, AuthRequest['prompt'][number]> = {
  1: 'none',
  2: 'login',
  3: 'consent',
  4: 'select_account',
  5: 'create',
};

export function toAuthRequest(proto: {
  id?: string;
  clientId?: string;
  scope?: string[];
  prompt?: number[];
  loginHint?: string;
  redirectUri?: string;
}): AuthRequest {
  return {
    id: proto.id ?? '',
    clientId: proto.clientId,
    scopes: proto.scope ?? [],
    prompt: (proto.prompt ?? []).map((p) => PROMPT[p]).filter(Boolean) as AuthRequest['prompt'],
    loginHint: proto.loginHint,
    redirectUri: proto.redirectUri,
  };
}

// Shared core: convert a proto Timestamp to an ISO string, with string-passthrough.
// A value that is ALREADY a string is returned verbatim (it is NOT routed through
// Date parsing) — callers rely on this to avoid re-normalizing ISO strings. On an
// absent/malformed proto Timestamp the caller-supplied `fallback` is returned.
// Note: this does NOT short-circuit empty strings — callers that must treat ''/falsy
// specially (e.g. mfaInitSkippedToIso) apply that guard before delegating here.
function timestampToIso<F extends string | null>(val: unknown, fallback: F): string | F {
  if (typeof val === 'string') return val;
  try {
    return timestampDate(val as Timestamp).toISOString();
  } catch {
    return fallback;
  }
}

// Converts a proto Timestamp (or ISO string) to an ISO string, or null if absent.
// Used to map User.mfaInitSkippedAt (P5).
export function mfaInitSkippedToIso(val: unknown): string | null {
  if (!val) return null;
  return timestampToIso(val, null);
}

// session/user/settings/branding/auth-method mappers (kept thin — fill fields as services land)
//
// Proto User.type is a oneof: { case: 'human', value: HumanUser } | { case: 'machine', ... } | { case: undefined }.
// mfaInitSkipped lives on HumanUser, accessible only through type.value — NOT via a top-level `.human` field.
// Reading proto.human?.mfaInitSkipped always produces undefined on real responses (P5 spec-review fix).
export function toUser(proto: {
  userId?: string;
  preferredLoginName?: string;
  details?: { resourceOwner?: string };
  type?: { case?: string; value?: Record<string, unknown> | null };
}): User {
  const humanValue = proto.type?.case === 'human' ? proto.type.value : undefined;
  return {
    id: proto.userId ?? '',
    loginName: proto.preferredLoginName ?? '',
    orgId: proto.details?.resourceOwner,
    mfaInitSkippedAt: mfaInitSkippedToIso(humanValue?.mfaInitSkipped),
  };
}

export function toSession(
  proto: {
    id?: string;
    factors?: {
      user?: { id?: string; loginName?: string; organizationId?: string };
      password?: { verifiedAt?: unknown };
      webAuthN?: { verifiedAt?: unknown; userVerified?: unknown };
      intent?: { verifiedAt?: unknown };
      totp?: { verifiedAt?: unknown };
      otpSms?: { verifiedAt?: unknown };
      otpEmail?: { verifiedAt?: unknown };
      u2f?: { verifiedAt?: unknown; userVerified?: unknown };
    };
    expirationDate?: unknown;
    changeDate?: unknown;
  },
  token: string
): Session {
  // Never let a malformed proto Timestamp throw out of the mapper into the
  // loader — degrade to '' (treated as "unset"). Unlike mfaInitSkippedToIso this has
  // no leading falsy guard: callers gate with `proto.x ? tsToIso(...) : ''`, and a
  // string value (incl. '') passes through verbatim via timestampToIso.
  const tsToIso = (val: unknown): string => timestampToIso(val, '');
  // Factor verifiedAt is now `Date | null`. Parse the proto Timestamp (or ISO string)
  // into a real Date; an absent or malformed value normalizes to null (treated as unverified).
  const tsToDate = (val: unknown): Date | null => {
    try {
      const d = typeof val === 'string' ? new Date(val) : timestampDate(val as Timestamp);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };
  const v = (x?: { verifiedAt?: unknown }): Date | null =>
    x?.verifiedAt ? tsToDate(x.verifiedAt) : null;
  return {
    id: proto.id ?? '',
    token,
    user: proto.factors?.user
      ? {
          id: proto.factors.user.id ?? '',
          loginName: proto.factors.user.loginName ?? '',
          orgId: proto.factors.user.organizationId,
        }
      : undefined,
    factors: {
      password: { verifiedAt: v(proto.factors?.password) },
      // passkey factor carries userVerified, which drives the passwordless-passkey MFA-satisfied rule
      passkey: {
        verifiedAt: v(proto.factors?.webAuthN),
        userVerified: Boolean(proto.factors?.webAuthN?.userVerified),
      },
      idpIntent: { verifiedAt: v(proto.factors?.intent) },
      // Real Zitadel populates these after an OTP/TOTP/U2F check; without
      // mapping them, mfa-routing.secondFactorFresh never sees a completed second factor.
      totp: { verifiedAt: v(proto.factors?.totp) },
      otpSms: { verifiedAt: v(proto.factors?.otpSms) },
      otpEmail: { verifiedAt: v(proto.factors?.otpEmail) },
      u2f: {
        verifiedAt: v(proto.factors?.u2f),
        userVerified: Boolean(proto.factors?.u2f?.userVerified),
      },
    },
    expiresAt: proto.expirationDate ? tsToIso(proto.expirationDate) : '',
    changedAt: proto.changeDate ? tsToIso(proto.changeDate) : '',
  };
}

/**
 * Maps a proto `Challenges` response message (from SetSessionResponse.challenges, field 3)
 * to the neutral `SessionChallenges` type consumed by routes.
 *
 * Proto shape (challenge_pb.d.ts):
 *   Challenges.webAuthN?: { publicKeyCredentialRequestOptions?: JsonObject }  — google.protobuf.Struct passthrough
 *   Challenges.otpSms?:   string  — the OTP code returned when RequestChallenges.OTPSMS.returnCode=true
 *   Challenges.otpEmail?: string  — the OTP code returned when RequestChallenges.OTPEmail uses returnCode delivery
 *
 * This is the authoritative mapper for the SetSession response path. The `toSession` mapper
 * (above) deliberately does NOT map challenges: the GetSession/Session entity proto carries no
 * challenges field, so that path never produces them on live Zitadel.
 */
export function toSessionChallenges(proto: {
  webAuthN?: { publicKeyCredentialRequestOptions?: unknown } | null;
  otpSms?: string | null;
  otpEmail?: string | null;
}): SessionChallenges {
  // proto.otpEmail is a string when Zitadel returns the code (returnCode delivery); it is
  // a non-empty string only for the returnCode case — for sendCode the field is absent/null.
  // Surface it ONLY through the typed `otpEmailCode` (the redundant untyped `otpEmail`
  // duplicate has been removed from SessionChallenges).
  return {
    ...(proto.webAuthN != null
      ? {
          webAuthN: {
            publicKeyCredentialRequestOptions: proto.webAuthN.publicKeyCredentialRequestOptions,
          },
        }
      : {}),
    ...(proto.otpEmail != null ? { otpEmailCode: proto.otpEmail } : {}),
    ...(proto.otpSms != null ? { otpSms: proto.otpSms } : {}),
  };
}

// AuthenticationMethodType enum → neutral AuthMethod (mirror @zitadel/proto user/v2):
// 1=PASSWORD, 2=PASSKEY, 3=IDP, 4=TOTP, 5=U2F, 6=OTP_SMS, 7=OTP_EMAIL
// NOTE: reality differs from the original locked plan (which had 5=otp_sms, 6=otp_email, 7=u2f).
// The actual generated enum in node_modules/@zitadel/proto/types/zitadel/user/v2/user_service_pb.d.ts
// shows U2F=5, OTP_SMS=6, OTP_EMAIL=7 — reality wins per the TDD protocol.
const AUTH_METHOD_MAP: Record<number, AuthMethod> = {
  1: 'password',
  2: 'passkey',
  3: 'idp',
  4: 'totp',
  5: 'u2f',
  6: 'otp_sms',
  7: 'otp_email',
};

/** Maps a single proto AuthenticationMethodType enum value to a neutral AuthMethod (or undefined for unknown). */
export function mapAuthMethod(type: number): AuthMethod | undefined {
  return AUTH_METHOD_MAP[type];
}

export function toAuthMethods(types: number[]): AuthMethod[] {
  return types.map((t) => AUTH_METHOD_MAP[t]).filter(Boolean) as AuthMethod[];
}

// Proto `google.protobuf.Duration` → milliseconds.
// Duration has `seconds` (int64 → bigint in generated code) and `nanos` (int32 → number).
// Zero or undefined → returns undefined so callers treat missing duration as "no expiry".
export function durationToMs(d: unknown): number | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const dur = d as { seconds?: unknown; nanos?: unknown };
  const secs = dur.seconds !== undefined ? Number(dur.seconds) : 0;
  const nanos = typeof dur.nanos === 'number' ? dur.nanos : 0;
  const ms = secs * 1000 + Math.round(nanos / 1_000_000);
  return ms === 0 ? undefined : ms;
}

// Login-policy second/multi factor TYPE enums.
// SECOND_FACTOR_MAP is a DIFFERENT enum from AUTH_METHOD_MAP above (per-user enrolled methods):
// it maps proto SecondFactorType (settings/v2 login_settings_pb.d.ts) — OTP(=TOTP)=1, U2F=2,
// OTP_EMAIL=3, OTP_SMS=4 — to the same neutral AuthMethod strings used by SECOND_FACTOR_METHODS /
// USE_SCREEN / capabilities keys. 0 (UNSPECIFIED) and unknown values map to undefined and are dropped.
const SECOND_FACTOR_MAP: Record<number, AuthMethod> = {
  1: 'totp',
  2: 'u2f',
  3: 'otp_email',
  4: 'otp_sms',
};

// MultiFactorType (settings/v2): U2F_WITH_VERIFICATION=1 → passwordless passkey in our model.
const MULTI_FACTOR_MAP: Record<number, AuthMethod> = {
  1: 'passkey',
};

/**
 * Maps a proto enum array via the supplied table, dropping unknown/unspecified values.
 * Returns undefined when the proto omits the field entirely (back-compat: callers treat
 * undefined as "no policy restriction"); returns [] for an explicit empty array.
 */
function mapFactorTypes(raw: unknown, table: Record<number, AuthMethod>): AuthMethod[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((v) => (typeof v === 'number' ? table[v] : undefined))
    .filter((m): m is AuthMethod => m !== undefined);
}

export function toLoginSettings(proto: Record<string, unknown>): LoginSettings {
  return {
    allowPassword: Boolean(proto.allowUsernamePassword),
    allowRegister: Boolean(proto.allowRegister),
    allowExternalIdp: Boolean(proto.allowExternalIdp),
    passkeysType: proto.passkeysType === 1 ? 'allowed' : 'not_allowed',
    forceMfa: Boolean(proto.forceMfa) || Boolean(proto.forceMfaLocalOnly),
    hidePasswordReset: Boolean(proto.hidePasswordReset),
    ignoreUnknownUsernames: Boolean(proto.ignoreUnknownUsernames),
    disableLoginWithEmail: Boolean(proto.disableLoginWithEmail),
    disableLoginWithPhone: Boolean(proto.disableLoginWithPhone),
    allowDomainDiscovery: Boolean(proto.allowDomainDiscovery),
    passwordCheckLifetimeMs: durationToMs(proto.passwordCheckLifetime),
    secondFactorCheckLifetimeMs: durationToMs(proto.secondFactorCheckLifetime),
    multiFactorCheckLifetimeMs: durationToMs(proto.multiFactorCheckLifetime),
    mfaInitSkipLifetimeMs: durationToMs(proto.mfaInitSkipLifetime), // P5
    defaultRedirectUri:
      typeof proto.defaultRedirectUri === 'string' && proto.defaultRedirectUri.length > 0
        ? proto.defaultRedirectUri
        : undefined,
    secondFactors: mapFactorTypes(proto.secondFactors, SECOND_FACTOR_MAP),
    multiFactors: mapFactorTypes(proto.multiFactors, MULTI_FACTOR_MAP),
  };
}

// PasswordComplexitySettings.minLength is uint64 → bigint in generated code.
// BigInt breaks JSON.stringify and React rendering, so we coerce it (and any
// other potential bigint fields) to number here.
// Proto fields inspected in password_settings_pb.d.ts:
//   minLength: bigint  ← coerced
//   requiresUppercase, requiresLowercase, requiresNumber, requiresSymbol: boolean (no coercion needed)
//   resourceOwnerType: enum number (no coercion needed)
export function toPasswordComplexity(settings: {
  minLength?: unknown;
  requiresUppercase?: unknown;
  requiresLowercase?: unknown;
  requiresNumber?: unknown;
  requiresSymbol?: unknown;
}): PasswordComplexity {
  return {
    minLength: settings.minLength !== undefined ? Number(settings.minLength) : 0,
    requiresUppercase: Boolean(settings.requiresUppercase),
    requiresLowercase: Boolean(settings.requiresLowercase),
    requiresNumber: Boolean(settings.requiresNumber),
    requiresSymbol: Boolean(settings.requiresSymbol),
  };
}

export function toBranding(proto: Record<string, unknown>): BrandingTheme {
  const themeUrl = (proto.lightTheme as { logoUrl?: string } | undefined)?.logoUrl;
  return {
    logoUrl: themeUrl,
    darkLogoUrl: (proto.darkTheme as { logoUrl?: string } | undefined)?.logoUrl,
    primaryColor: (proto.lightTheme as { primaryColor?: string } | undefined)?.primaryColor,
    hideLoginNameSuffix: Boolean(proto.hideLoginNameSuffix),
  };
}

// Proto shape: AddHumanUserRequest
//   profile: { givenName, familyName }
//   email:   { email } (IsVerified defaults false — Zitadel sends a verification code)
//   organization: { org: { case: 'orgId', value: string } }  ← Organization oneof
//   passwordType: { case: 'password', value: { password, changeRequired: false } }  ← oneof
// Plan adjustment: organization nesting is organization.org.{ case:'orgId', value } (not a flat orgId field).
// Plan adjustment: passwordType value is Password { password, changeRequired } (not just a string).
export function toRegisterRequest(input: RegisterInput): {
  profile: { givenName: string; familyName: string };
  email:
    | { email: string }
    | {
        email: string;
        verification: { case: 'sendCode'; value: { urlTemplate: string } };
      }
    | {
        email: string;
        verification: { case: 'isVerified'; value: true };
      };
  organization?: { org: { case: 'orgId'; value: string } };
  passwordType:
    | { case: 'password'; value: { password: string; changeRequired: boolean } }
    | { case: undefined; value?: undefined };
} {
  // Priority: emailVerified > verifyUrlTemplate > plain (Zitadel default sends mail).
  const emailField: ReturnType<typeof toRegisterRequest>['email'] = input.emailVerified
    ? { email: input.email, verification: { case: 'isVerified' as const, value: true as const } }
    : input.verifyUrlTemplate
      ? {
          email: input.email,
          verification: {
            case: 'sendCode' as const,
            value: { urlTemplate: input.verifyUrlTemplate },
          },
        }
      : { email: input.email };

  return {
    profile: { givenName: input.firstName, familyName: input.lastName },
    email: emailField,
    ...(input.orgId
      ? { organization: { org: { case: 'orgId' as const, value: input.orgId } } }
      : {}),
    passwordType: input.password
      ? { case: 'password' as const, value: { password: input.password, changeRequired: false } }
      : { case: undefined },
  };
}

// ── IdP mappers (Phase 4) ─────────────────────────────────────────────────────

// Proto: zitadel.settings.v2.IdentityProvider
//   id, name, type (IdentityProviderType enum number), options
// type is a numeric enum — use the enum name so idp-slug.ts can match on 'GOOGLE'/'GITHUB'.
// IdentityProviderType values (verified against @zitadel/proto 1.3.1 login_settings_pb.d.ts):
//   0=UNSPECIFIED, 1=OIDC, 2=JWT, 3=LDAP, 4=OAUTH, 5=AZURE_AD, 6=GITHUB,
//   7=GITHUB_ES, 8=GITLAB, 9=GITLAB_SELF_HOSTED, 10=GOOGLE, 11=SAML, 12=APPLE
const IDP_TYPE_NAME: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'OIDC',
  2: 'JWT',
  3: 'LDAP',
  4: 'OAUTH',
  5: 'AZURE_AD',
  6: 'GITHUB',
  7: 'GITHUB_ES',
  8: 'GITLAB',
  9: 'GITLAB_SELF_HOSTED',
  10: 'GOOGLE',
  11: 'SAML',
  12: 'APPLE',
};

export function toIdProvider(idp: { id?: string; name?: string; type?: number }): IdProvider {
  return {
    id: idp.id ?? '',
    name: idp.name ?? '',
    type: IDP_TYPE_NAME[idp.type ?? 0] ?? 'UNSPECIFIED',
  };
}

// Proto: zitadel.user.v2.RetrieveIdentityProviderIntentResponse
//   idpInformation: IDPInformation { idpId, userId, userName, access oneof { oauth: { accessToken }, ldap, saml } }
//   userId: string  (empty string = no existing Zitadel user)
//   addHumanUser: AddHumanUserRequest (optional — used to pre-fill registration)
//     .profile: SetHumanProfile { givenName, familyName, displayName? }
//     .email:   SetHumanEmail { email, verification oneof { isVerified: bool, sendCode: {} } }
export function toIdpIntentResult(resp: {
  idpInformation?: {
    idpId?: string;
    userId?: string;
    userName?: string;
    access?: { case?: string; value?: unknown };
  };
  userId?: string;
  addHumanUser?: {
    profile?: { givenName?: string; familyName?: string; displayName?: string };
    email?: {
      email?: string;
      verification?: { case?: string; value?: unknown };
    };
  };
}): IdpIntentResult {
  const info = resp.idpInformation;
  const information: IdpInformation = {
    idpId: info?.idpId ?? '',
    idpUserId: info?.userId ?? '',
    idpUserName: info?.userName ?? '',
    // access is a oneof: { case: 'oauth', value: IDPOAuthAccessInformation }
    // accessToken only present for OAuth/OIDC providers (Google, GitHub).
    accessToken:
      info?.access?.case === 'oauth' &&
      info.access.value !== null &&
      typeof info.access.value === 'object' &&
      'accessToken' in (info.access.value as object)
        ? ((info.access.value as { accessToken?: string }).accessToken ?? undefined)
        : undefined,
  };

  const rawUserId = resp.userId ?? '';
  const userId = rawUserId.length > 0 ? rawUserId : null;

  let draft: IdpUserDraft | null = null;
  const ahu = resp.addHumanUser;
  if (ahu) {
    const emailVerified =
      ahu.email?.verification?.case === 'isVerified'
        ? Boolean(ahu.email.verification.value)
        : false;
    draft = {
      email: ahu.email?.email ?? undefined,
      emailVerified,
      firstName: ahu.profile?.givenName ?? undefined,
      lastName: ahu.profile?.familyName ?? undefined,
      displayName: ahu.profile?.displayName ?? undefined,
    };
  }

  return { information, userId, draft };
}

// Proto: zitadel.user.v2.IDPLink { idpId, userId, userName }
// Used as the body of AddIDPLinkRequest.idpLink.
// Note: the proto field is `userId` (the IdP-side user id), not the Zitadel user id.
export function toIdpLinkRequest(link: IdpLink): {
  idpId: string;
  userId: string;
  userName: string;
} {
  return {
    idpId: link.idpId,
    userId: link.idpUserId,
    userName: link.idpUserName,
  };
}

// Map a proto IDPLink response entry to the neutral IdpLink shape.
// This function was required by listIdpLinks in zitadel/index.ts to convert the proto
// IDPLink fields (idpId, userId, userName) to the neutral IdpLink shape (idpId, idpUserId,
// idpUserName). The spec's Step 1 noted "mappers already return the neutral types" for the
// retrieveIdpIntent path; the listIdpLinks path needed this additional mapper.
// Proto field `userId` is the IdP-side user id (not the Zitadel user id).
export function toIdpLink(link: { idpId?: string; userId?: string; userName?: string }): IdpLink {
  return {
    idpId: link.idpId ?? '',
    idpUserId: link.userId ?? '',
    idpUserName: link.userName ?? '',
  };
}

// Proto shape: SetPasswordRequest
//   userId
//   newPassword: { password, changeRequired: false }
//   verification: { case: 'verificationCode', value: code }
// Plan adjustment: verification is a oneof (not a flat field).
export function toSetPasswordWithCodeRequest(
  userId: string,
  code: string,
  password: string
): {
  userId: string;
  newPassword: { password: string; changeRequired: boolean };
  verification: { case: 'verificationCode'; value: string };
} {
  return {
    userId,
    newPassword: { password, changeRequired: false },
    verification: { case: 'verificationCode' as const, value: code },
  };
}

// ── P5 MFA Checks mapper ──────────────────────────────────────────────────────
// Translates neutral SessionChecks MFA fields into the proto Checks partial object.
// The caller (updateSession / createSession) spreads this into the ChecksSchema create() call.
// Proto shapes (verified against session/v2/session_service_pb.d.ts):
//   webAuthN: CheckWebAuthN { credentialAssertionData: JsonObject }
//   totp:     CheckTOTP { code: string }
//   otpSms:   CheckOTP  { code: string }
//   otpEmail: CheckOTP  { code: string }
export function toChecks(checks: SessionChecks): {
  webAuthN?: { credentialAssertionData: JsonObject };
  totp?: { code: string };
  otpSms?: { code: string };
  otpEmail?: { code: string };
} {
  return {
    ...(checks.webAuthN !== undefined
      ? {
          webAuthN: {
            credentialAssertionData: checks.webAuthN.credentialAssertionData as JsonObject,
          },
        }
      : {}),
    ...(checks.totp !== undefined ? { totp: { code: checks.totp } } : {}),
    ...(checks.otpSms !== undefined ? { otpSms: { code: checks.otpSms } } : {}),
    ...(checks.otpEmail !== undefined ? { otpEmail: { code: checks.otpEmail } } : {}),
  };
}

// ── P6 device / saml mappers ─────────────────────────────────────────────────

/**
 * Maps a Zitadel DeviceAuthorizationRequest proto to the neutral DeviceAuthRequest.
 * Proto fields verified against @zitadel/proto 1.3.1 oidc/v2/authorization_pb.d.ts:
 *   id (string), clientId (string), scope (string[]), appName (string), projectName (string)
 */
export function toDeviceAuthRequest(p: {
  id: string;
  appName?: string;
  scope?: string[];
}): DeviceAuthRequest {
  return { id: p.id, appName: p.appName, scope: p.scope ?? [] };
}

/**
 * Maps a Zitadel SAMLRequest proto to the neutral AuthRequest.
 * SAMLRequest carries no OIDC scopes or prompt — those fields are set to empty.
 * Proto fields verified against @zitadel/proto 1.3.1 saml/v2/authorization_pb.d.ts:
 *   id, creationDate, issuer, assertionConsumerService, relayState, binding
 * There is no clientId field on SAMLRequest — omit it from the neutral type.
 */
export function toSamlAuthRequest(samlRequest: { id: string }): AuthRequest {
  // only id is consumed — the caller guards against empty/missing ids
  return {
    id: samlRequest.id,
    scopes: [],
    prompt: [],
  };
}

/**
 * Maps a CreateResponseResponse proto to the neutral SamlResponse.
 * Proto binding oneof (verified against saml_service_pb.d.ts):
 *   { case: 'redirect', value: RedirectResponse (empty) }
 *   { case: 'post', value: PostResponse { relayState: string; samlResponse: string } }
 */
export function toSamlResponse(p: {
  url: string;
  binding:
    | { case: 'redirect'; value: object }
    | { case: 'post'; value: { relayState: string; samlResponse: string } }
    | { case: undefined; value?: undefined };
}): SamlResponse {
  if (p.binding.case === 'post') {
    return {
      url: p.url,
      binding: 'post',
      relayState: p.binding.value.relayState,
      samlResponse: p.binding.value.samlResponse,
    };
  }
  // binding.case === 'redirect' or undefined (proto3 default) — treat both as redirect
  return { url: p.url, binding: 'redirect' };
}

// ── P5 Challenge Request mapper ───────────────────────────────────────────────
// Maps SessionChecks.challenges to a proto RequestChallenges partial object for
// SetSessionRequest.challenges (and CreateSessionRequest.challenges).
// Proto shapes verified against session/v2/challenge_pb.d.ts:
//   RequestChallenges.webAuthN: { domain: string; userVerificationRequirement: UserVerificationRequirement }
//   RequestChallenges.otpSms:   { returnCode: boolean }
//   RequestChallenges.otpEmail: { deliveryType: { case: 'sendCode', value: {} } }
//                             | { deliveryType: { case: 'returnCode', value: {} } }
export function toChallengeRequest(challenges: NonNullable<SessionChecks['challenges']>): {
  webAuthN?: {
    domain: string;
    userVerificationRequirement: UserVerificationRequirement;
  };
  otpSms?: { returnCode: boolean };
  otpEmail?:
    | { deliveryType: { case: 'sendCode'; value: { urlTemplate?: string } } }
    | { deliveryType: { case: 'returnCode'; value: Record<string, never> } };
} {
  // Discriminated union on `kind` (no runtime four-way value discriminant).
  //   'send'          → sendCode with an empty value ({}) → provider default link
  //   'send-template' → sendCode, carrying the template so Zitadel mails OUR link
  //   'return-code'   → returnCode delivery — code is NOT emailed; it is returned on the
  //                     SetSession response and surfaces on Session.challenges.otpEmailCode
  // A missing `kind` is a compile error (the switch is exhaustive); an absent challenge → undefined.
  const otpEmail = challenges.otpEmail;
  type OtpEmailProto =
    | { deliveryType: { case: 'sendCode'; value: { urlTemplate?: string } } }
    | { deliveryType: { case: 'returnCode'; value: Record<string, never> } }
    | undefined;
  const deriveOtpEmail = (): OtpEmailProto => {
    if (otpEmail === undefined) return undefined;
    switch (otpEmail.kind) {
      case 'send':
        return { deliveryType: { case: 'sendCode', value: {} } };
      case 'send-template':
        return {
          deliveryType: { case: 'sendCode', value: { urlTemplate: otpEmail.urlTemplate } },
        };
      case 'return-code':
        return { deliveryType: { case: 'returnCode', value: {} } };
      default: {
        // Exhaustiveness guard: a new OtpEmailChallenge kind without a case here is a compile error.
        const _exhaustive: never = otpEmail;
        return _exhaustive;
      }
    }
  };
  const otpEmailProto = deriveOtpEmail();

  return {
    ...(challenges.webAuthN !== undefined
      ? {
          webAuthN: {
            domain: challenges.webAuthN.domain,
            userVerificationRequirement:
              challenges.webAuthN.userVerificationRequirement === 'required'
                ? UserVerificationRequirement.REQUIRED
                : UserVerificationRequirement.DISCOURAGED,
          },
        }
      : {}),
    ...(challenges.otpSms === true ? { otpSms: { returnCode: false } } : {}),
    ...(otpEmailProto !== undefined ? { otpEmail: otpEmailProto } : {}),
  };
}
