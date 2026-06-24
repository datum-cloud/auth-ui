// app/resources/signup/signup.service.ts
//
// Pass 2 extraction: the action BUSINESS logic for the signup domain — the
// register-and-link (IdP) compose, the password-first hand-off, the passkey-first
// register, and the password-set register, each with their enumeration-safe
// ALREADY_EXISTS handling and post-register routing. React rendering, CSRF, the
// final redirect()/data() wiring and cookie serialization stay in the route modules.
//
// Each function takes a provider + plain inputs (already parsed/validated by the
// route's schema) + the caller's current session list, and returns a typed result
// the route turns into a redirect()/data() response. No Request parsing, no CSRF,
// no cookie I/O lives here.
import type { AuthProvider, SessionOpts } from '@/modules/auth/auth-provider';
import {
  addSession,
  sessionEntryFromSession,
  type SessionEntry,
} from '@/modules/auth/session/cookie';
import { ProviderError } from '@/modules/auth/types';
import { authorizeHandbackTarget } from '@/resources/shared/next-step-params';
import { postRegisterStep } from '@/resources/signup/post-register';
import {
  verifyUrlTemplate,
  signupCompleteUrlTemplate,
} from '@/resources/verify/verify-url-template';
import { logAuthEvent, hashActor } from '@/server/observability';

/**
 * Zitadel session-metadata key for the MaxMind device-tracking token. This string is a
 * HARD CONTRACT with the Go backend: auth-provider-zitadel reads this exact key and
 * mirrors it to the milo annotation `iam.miloapis.com/maxmind-tracking-token`, which the
 * fraud service consumes. The backend allowlists metadata keys — keep this in sync with
 * the Go-side metadataAnnotationKeys allowlist or the token is silently dropped.
 */
const MAXMIND_TRACKING_TOKEN_METADATA_KEY = 'maxmind/tracking-token';

// ── shared result shapes ──────────────────────────────────────────────────────

/**
 * A "register succeeded, persist a session and redirect" outcome. The route
 * serializes `sessions` into the cookie and `redirect()`s to `target`.
 */
export interface SignupRedirectResult {
  kind: 'redirect';
  target: string;
  sessions: SessionEntry[];
}

/**
 * A "register succeeded, persist a session and render check-your-email" outcome.
 * The route serializes `sessions` and returns a 200 with the `sent` payload.
 */
export interface SignupSentWithSessionResult {
  kind: 'sent-with-session';
  email: string;
  sessions: SessionEntry[];
}

/**
 * Enumeration-safe duplicate-email outcome: the route returns the IDENTICAL
 * generic check-your-email response (no session cookie) as a fresh signup — a
 * duplicate email is indistinguishable from a new account.
 */
export interface SignupSentResult {
  kind: 'sent';
  email: string;
}

/** Plain redirect with no session to persist (password-first hand-off). */
export interface SignupRedirectOnlyResult {
  kind: 'redirect-only';
  target: string;
}

// ── register-and-link (IdP intent rode in from /sso/:provider/callback) ────────

export interface SignupIdpLinkInput {
  email: string;
  firstName: string;
  lastName: string;
  organization?: string;
  requestId?: string;
  idpIntentId: string;
  idpIntentToken: string;
  idpId: string;
  idpUserId: string;
  idpUserName: string;
  /** When true the IdP has vouched for the email — create the user already-verified. */
  emailVerified?: boolean;
  /** Zitadel session userAgent metadata (Device/Location in cloud-portal). */
  userAgent?: SessionOpts['userAgent'];
}

/**
 * Phase 4 register-and-link: compose register → addIdpLink → createSession in one
 * logical step (route/flow level, not an AuthProvider method). IdP users are
 * passwordless — they skip the /signup/password path.
 *
 * Link explicitly via addIdpLink — RegisterInput.idpLink is a dead
 * field no provider reads, so passing it to register() was a confusing no-op.
 * addIdpLink is the single, real link path.
 */
export async function registerAndLinkIdp(
  provider: AuthProvider,
  list: SessionEntry[],
  input: SignupIdpLinkInput
): Promise<SignupRedirectResult> {
  const { email, firstName, lastName, organization, requestId, userAgent } = input;
  const idpLink = {
    idpId: input.idpId,
    idpUserId: input.idpUserId,
    idpUserName: input.idpUserName,
  };
  const user = await provider.register({
    email,
    firstName,
    lastName,
    orgId: organization,
    emailVerified: input.emailVerified ?? false,
  });
  await provider.addIdpLink(user.id, idpLink);
  const session = await provider.createSession(
    { idpIntent: { idpIntentId: input.idpIntentId, idpIntentToken: input.idpIntentToken } },
    { orgId: organization, requestId, userId: user.id, userAgent }
  );
  const sessions = addSession(
    list,
    sessionEntryFromSession(session, { loginName: user.loginName, organization, requestId })
  );
  logAuthEvent('signup.requested', 'success', { actor: hashActor(user.loginName), organization });
  // Thread the just-created session id so /authorize finishes the callback via resolveOidc's
  // explicit-sessionId hand-back (runCallback) instead of re-running decideAuthorize — without it
  // a brand-new IdP user completing a prompt=select_account / prompt=login ceremony loops straight
  // back to /accounts (or /login). Mirrors the password path's hand-back.
  const target = authorizeHandbackTarget(requestId, session.id);
  return { kind: 'redirect', target, sessions };
}

// ── password-first hand-off (allowPassword) ────────────────────────────────────

export interface PasswordFirstHandoffInput {
  email: string;
  firstName: string;
  lastName: string;
  organization?: string;
  requestId?: string;
  deviceTrackingToken?: string;
}

/**
 * Password-first path: carry all fields to /signup/password. loginName in the URL
 * param lets signupRateLimit key on it for /signup/password.
 */
export function passwordFirstHandoff(input: PasswordFirstHandoffInput): SignupRedirectOnlyResult {
  const { email, firstName, lastName, organization, requestId, deviceTrackingToken } = input;
  logAuthEvent('signup.requested', 'success', { actor: hashActor(email), organization });
  const params = new URLSearchParams({ loginName: email, firstName, lastName });
  if (organization) params.set('organization', organization);
  if (requestId) params.set('requestId', requestId);
  if (deviceTrackingToken) params.set('deviceTrackingToken', deviceTrackingToken);
  return { kind: 'redirect-only', target: `/signup/password?${params}` };
}

// ── passkey-first register (no allowPassword) ──────────────────────────────────

export interface PasskeyFirstRegisterInput {
  email: string;
  firstName: string;
  lastName: string;
  organization?: string;
  requestId?: string;
  /** Whether the org requires email verification (requireEmailVerification()). */
  requireVerification: boolean;
  /**
   * TRUSTED app origin (scheme + host) from trustedAppOrigin(request) — used to
   * steer the verification mail's link back to OUR /verify route. MUST come from
   * trusted config (PUBLIC_ORIGIN), never the request Host header, to prevent
   * Host-header email-link injection.
   */
  origin: string;
  /** MaxMind device-fingerprint token captured client-side; attached as session metadata. */
  deviceTrackingToken?: string;
  /** Zitadel session userAgent metadata (Device/Location in cloud-portal). */
  userAgent?: SessionOpts['userAgent'];
}

export type PasskeyFirstRegisterResult =
  | SignupSentWithSessionResult
  | SignupSentResult
  | SignupRedirectResult;

type RegisteredUser = Awaited<ReturnType<AuthProvider['register']>>;

/**
 * Shared enumeration-safe register flow for the passkey-first and with-password
 * paths. Both share: the createSession → addSession wiring, the require-verification
 * success/ALREADY_EXISTS audits (identical 'signup.requested'), and the
 * no-verification ALREADY_EXISTS audit. They DIVERGE on:
 *   - `register`: the provider.register call (passkey-first omits password and only
 *     attaches verifyUrlTemplate when verification is required; with-password always
 *     passes a password + verifyUrlTemplate).
 *   - `hasPassword`: feeds postRegisterStep.
 *   - `noVerifySuccessAudit`: the no-verification success path emits DIFFERENT audit
 *     — passkey-first 'signup.requested'{actor,organization}, with-password
 *     'signup.created'{userId,actor(loginName)}. Parameterized, never collapsed.
 */
async function runEnumerationSafeRegister(
  provider: AuthProvider,
  list: SessionEntry[],
  cfg: {
    email: string;
    organization?: string;
    requestId?: string;
    deviceTrackingToken?: string;
    userAgent?: SessionOpts['userAgent'];
    requireVerification: boolean;
    hasPassword: boolean;
    register: () => Promise<RegisteredUser>;
    noVerifySuccessAudit: (user: RegisteredUser) => void;
  }
): Promise<SignupSentWithSessionResult | SignupSentResult | SignupRedirectResult> {
  const { email, organization, requestId, deviceTrackingToken, userAgent } = cfg;
  const sessionMetadata = deviceTrackingToken
    ? { [MAXMIND_TRACKING_TOKEN_METADATA_KEY]: deviceTrackingToken }
    : undefined;

  const persistSession = async (user: RegisteredUser): Promise<SessionEntry[]> => {
    const session = await provider.createSession(
      {},
      { orgId: organization, requestId, userId: user.id, metadata: sessionMetadata, userAgent }
    );
    return addSession(
      list,
      sessionEntryFromSession(session, { loginName: user.loginName, organization, requestId })
    );
  };

  if (cfg.requireVerification) {
    try {
      const user = await cfg.register();
      const sessions = await persistSession(user);
      logAuthEvent('signup.requested', 'success', { actor: hashActor(email), organization });
      return { kind: 'sent-with-session', email, sessions };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'ALREADY_EXISTS') {
        // ENUMERATION SAFETY: equivalent-cost no-op path (timing hardening is a Phase 6 item).
        // We intentionally do NOT branch audit outcome on existence — same event as success.
        logAuthEvent('signup.requested', 'success', { actor: hashActor(email) });
        return { kind: 'sent', email };
      }
      throw error;
    }
  }

  // Verification not required: register and route forward.
  try {
    const user = await cfg.register();
    const sessions = await persistSession(user);
    // Audit shape DIVERGES per path — parameterized, never collapsed to one event.
    cfg.noVerifySuccessAudit(user);
    const target = postRegisterStep({
      hasPassword: cfg.hasPassword,
      emailVerified: false,
      requireVerification: false,
      loginName: user.loginName,
      userId: user.id,
      organization,
      requestId,
    });
    return { kind: 'redirect', target, sessions };
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'ALREADY_EXISTS') {
      // Minor asymmetry: no email step when verification is off, but still generic response.
      logAuthEvent('signup.requested', 'success', { actor: hashActor(email) });
      return { kind: 'sent', email };
    }
    throw error;
  }
}

/**
 * Passkey-first path: register directly, then apply enumeration-safe handling.
 *
 * When verification is required, both the fresh-signup and the ALREADY_EXISTS
 * branches yield the generic check-your-email response (the success branch also
 * persists a ceremony session so the /verify return flow can resume). When
 * verification is off, register and route forward via postRegisterStep; a
 * duplicate still yields the generic response.
 */
export async function registerPasskeyFirst(
  provider: AuthProvider,
  list: SessionEntry[],
  input: PasskeyFirstRegisterInput
): Promise<PasskeyFirstRegisterResult> {
  const { email, firstName, lastName, organization, requestId, origin } = input;

  return runEnumerationSafeRegister(provider, list, {
    email,
    organization,
    requestId,
    deviceTrackingToken: input.deviceTrackingToken,
    userAgent: input.userAgent,
    requireVerification: input.requireVerification,
    hasPassword: false,
    // Passkey-first attaches verifyUrlTemplate ONLY when verification is required;
    // the no-verification path registers without it (preserves original behavior).
    register: () =>
      input.requireVerification
        ? provider.register({
            email,
            firstName,
            lastName,
            orgId: organization,
            verifyUrlTemplate: verifyUrlTemplate({ origin, requestId }),
          })
        : provider.register({ email, firstName, lastName, orgId: organization }),
    noVerifySuccessAudit: () =>
      logAuthEvent('signup.requested', 'success', { actor: hashActor(email), organization }),
  });
}

// ── set-a-password register (/signup/password) ─────────────────────────────────

export interface RegisterWithPasswordInput {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  organization?: string;
  requestId?: string;
  /** Whether the org requires email verification (requireEmailVerification()). */
  requireVerification: boolean;
  /** TRUSTED app origin (scheme + host) from trustedAppOrigin(request). See above. */
  origin: string;
  /** MaxMind device-fingerprint token captured client-side; attached as session metadata. */
  deviceTrackingToken?: string;
  /** Zitadel session userAgent metadata (Device/Location in cloud-portal). */
  userAgent?: SessionOpts['userAgent'];
}

export type RegisterWithPasswordResult =
  | SignupSentWithSessionResult
  | SignupSentResult
  | SignupRedirectResult;

/**
 * /signup/password register: register with a password, then apply enumeration-safe
 * handling. Mirrors registerPasskeyFirst but always passes a password and uses the
 * `hasPassword: true` postRegisterStep when verification is off.
 *
 * Shared enumeration-safe registration: the success path and the ALREADY_EXISTS
 * path return the IDENTICAL response when verification is required, so a duplicate
 * email is indistinguishable from a fresh signup.
 */
export async function registerWithPassword(
  provider: AuthProvider,
  list: SessionEntry[],
  input: RegisterWithPasswordInput
): Promise<RegisterWithPasswordResult> {
  const { email, firstName, lastName, password, organization, requestId, origin } = input;

  // Steer the verification mail's link back to OUR /verify route (raw provider
  // placeholders, filled by Zitadel). requestId rides along so the post-verify step
  // can resume an OIDC/SAML ceremony. The origin comes from trusted config
  // (PUBLIC_ORIGIN), NOT the request Host header, to block Host-header injection.
  const tmpl = verifyUrlTemplate({ origin, requestId });

  return runEnumerationSafeRegister(provider, list, {
    email,
    organization,
    requestId,
    deviceTrackingToken: input.deviceTrackingToken,
    userAgent: input.userAgent,
    requireVerification: input.requireVerification,
    hasPassword: true,
    // With-password always passes a password + verifyUrlTemplate (both branches).
    register: () =>
      provider.register({
        email,
        firstName,
        lastName,
        password,
        orgId: organization,
        verifyUrlTemplate: tmpl,
      }),
    // Distinct audit from the passkey path: 'signup.created' carrying userId, hashing loginName.
    noVerifySuccessAudit: (user) =>
      logAuthEvent('signup.created', 'success', {
        userId: user.id,
        actor: hashActor(user.loginName),
      }),
  });
}

// ── email-link (passwordless) register ────────────────────────────────────────

export interface EmailLinkSignupInput {
  email: string;
  firstName: string;
  lastName: string;
  organization?: string;
  requestId?: string;
  /**
   * TRUSTED app origin (scheme + host) from trustedAppOrigin(request) — used to
   * steer the verification mail's link back to OUR /signup/complete route. MUST come
   * from trusted config (PUBLIC_ORIGIN), never the request Host header, to prevent
   * Host-header email-link injection.
   */
  origin: string;
  /** MaxMind device-fingerprint token captured client-side (unused in the sessionless path, reserved for future use). */
  deviceTrackingToken?: string;
}

/**
 * Passwordless email-link signup: register without a password and send ONE
 * verification email whose link targets /signup/complete (to prompt passkey setup).
 *
 * Enumeration-safe: a duplicate-email ALREADY_EXISTS error is caught and
 * silently discarded — the caller receives the IDENTICAL generic "sent" result
 * as a fresh signup, so account existence is not detectable.
 */
export async function registerEmailLinkSignup(
  provider: AuthProvider,
  _list: SessionEntry[],
  input: EmailLinkSignupInput
): Promise<SignupSentResult> {
  const { email, firstName, lastName, organization, requestId, origin } = input;
  try {
    await provider.register({
      email,
      firstName,
      lastName,
      orgId: organization,
      verifyUrlTemplate: signupCompleteUrlTemplate({ origin, requestId, organization }),
    });
  } catch (error) {
    if (!(error instanceof ProviderError && error.code === 'ALREADY_EXISTS')) throw error;
    // ENUMERATION SAFETY: fall through — identical response as the success path.
  }
  logAuthEvent('signup.requested', 'success', { actor: hashActor(email), organization });
  return { kind: 'sent', email };
}

// ── email-link signup completion (/signup/complete) ────────────────────────────

export interface CompleteEmailLinkInput {
  userId: string;
  code: string;
  loginName: string;
  organization?: string;
  requestId?: string;
  /** When present, nudge the user toward passkey setup (skippable). */
  next?: 'passkey';
  /** MaxMind device-fingerprint token captured client-side; attached as session metadata. */
  deviceTrackingToken?: string;
  /** Zitadel session userAgent metadata (Device/Location in cloud-portal). */
  userAgent?: SessionOpts['userAgent'];
}

/**
 * Completion step for the passwordless email-link signup flow. Called when the
 * user clicks the verification link in their email:
 *
 * 1. verifyEmail  — proves the user owns the address
 * 2. addOtpEmail  — enroll the email OTP factor (now allowed, email is verified)
 * 3. createSession / updateSession x2 — self-authenticate via returnCode challenge
 *    (the OTP code is never emailed; the provider returns it in-band)
 * 4. Return a redirect to /setup/passkey (skippable nudge) plus the new session.
 */
export async function completeEmailLinkSignup(
  provider: AuthProvider,
  list: SessionEntry[],
  input: CompleteEmailLinkInput
): Promise<SignupRedirectResult> {
  const { userId, code, loginName, organization, requestId, deviceTrackingToken, userAgent } =
    input;

  // Step 1: verify email ownership using the code from the verification link.
  await provider.verifyEmail(userId, code);

  // Step 2: enroll the email OTP factor (requires verified email — just proven above).
  await provider.addOtpEmail(userId);

  // Step 3a: open a session for this user.
  const metadata = deviceTrackingToken
    ? { [MAXMIND_TRACKING_TOKEN_METADATA_KEY]: deviceTrackingToken }
    : undefined;
  const session = await provider.createSession(
    {},
    { orgId: organization, requestId, userId, metadata, userAgent }
  );

  // Step 3b: request a returnCode challenge — the OTP code lands on the returned session,
  // NOT in the user's inbox, so we can complete the factor in the next call.
  const challenged = await provider.updateSession(session.id, session.token, {
    // Discriminated email-OTP challenge — return-code delivery (code rides back in-band).
    challenges: { otpEmail: { kind: 'return-code' } },
  });
  const otpCode = challenged.challenges?.otpEmailCode ?? '';

  // Step 3c: complete the otpEmail factor server-side with the returned code.
  const verified = await provider.updateSession(session.id, challenged.token, {
    otpEmail: otpCode,
  });

  // Step 4: persist the session and redirect to the (skippable) passkey-setup nudge.
  // `id` is pinned to the original session (the entry we're persisting under), while the
  // token/timestamps come from the post-`updateSession` `verified` result.
  const sessions = addSession(
    list,
    sessionEntryFromSession(
      {
        id: session.id,
        token: verified.token,
        changedAt: verified.changedAt,
        expiresAt: verified.expiresAt,
      },
      { loginName, organization, requestId }
    )
  );

  logAuthEvent('signup.created', 'success', { userId, actor: hashActor(loginName) });

  const params = new URLSearchParams({ loginName, userId });
  if (organization) params.set('organization', organization);
  if (requestId) params.set('requestId', requestId);
  params.set('force', 'false');
  params.set('checkAfter', 'false');

  return { kind: 'redirect', target: `/setup/passkey?${params.toString()}`, sessions };
}

// Re-exported so callers/tests can reach post-register routing through the barrel.
export { postRegisterStep };
export type { PostRegisterInput } from '@/resources/signup/post-register';
