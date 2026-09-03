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
import { trackServerEvent } from '@/modules/analytics/rybbit.server';
import type { AuthProvider, SessionOpts } from '@/modules/auth/auth-provider';
import {
  addSession,
  sessionEntryFromSession,
  type SessionEntry,
} from '@/modules/auth/session/cookie';
import { ProviderError } from '@/modules/auth/types';
import { authorizeHandbackTarget } from '@/resources/shared/next-step-params';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { postRegisterStep } from '@/resources/signup/post-register';
import { allowResend } from '@/resources/signup/signup-resend-limit';
import {
  verifyUrlTemplate,
  signupCompleteUrlTemplate,
} from '@/resources/verify/verify-url-template';
import { logAuthEvent, hashActor } from '@/server/observability';
import { realSleep, type Sleep } from '@/server/timing';

/**
 * Zitadel session-metadata key for the MaxMind device-tracking token. This string is a
 * HARD CONTRACT with the Go backend: auth-provider-zitadel reads this exact key and
 * mirrors it to the milo annotation `iam.miloapis.com/maxmind-tracking-token`, which the
 * fraud service consumes. The backend allowlists metadata keys — keep this in sync with
 * the Go-side metadataAnnotationKeys allowlist or the token is silently dropped.
 */
export const MAXMIND_TRACKING_TOKEN_METADATA_KEY = 'maxmind/tracking-token';

// ── shared result shapes ──────────────────────────────────────────────────────

/**
 * A "register succeeded, persist a session and redirect" outcome. The route
 * serializes `sessions` into the cookie and `redirect()`s to `target`.
 */
export interface SignupRedirectResult {
  kind: 'redirect';
  target: string;
  sessions: SessionEntry[];
  /** The created/authenticated account's loginName — write-site key for the passkey-hint. */
  loginName?: string;
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
  /** MaxMind device-fingerprint token captured client-side; attached as session metadata. */
  deviceTrackingToken?: string;
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
  // Resolve the effective registration org — org-first (explicit orgId from the ceremony URL),
  // then ZITADEL_DEFAULT_ORG_ID env pin, then the provider's instance Default Organization.
  // Raw `organization` is undefined on a bare (no ?organization=) flow, causing Zitadel's
  // FAILED_PRECONDITION on addHumanUser when no org is supplied to register().
  const registrationOrg = await resolveOrg(provider, organization);
  const idpLink = {
    idpId: input.idpId,
    idpUserId: input.idpUserId,
    idpUserName: input.idpUserName,
  };
  const user = await provider.register({
    email,
    firstName,
    lastName,
    orgId: registrationOrg,
    emailVerified: input.emailVerified ?? false,
  });
  await provider.addIdpLink(user.id, idpLink);
  const sessionMetadata = input.deviceTrackingToken
    ? { [MAXMIND_TRACKING_TOKEN_METADATA_KEY]: input.deviceTrackingToken }
    : undefined;
  const session = await provider.createSession(
    { idpIntent: { idpIntentId: input.idpIntentId, idpIntentToken: input.idpIntentToken } },
    { orgId: registrationOrg, requestId, userId: user.id, metadata: sessionMetadata, userAgent }
  );
  const sessions = addSession(
    list,
    sessionEntryFromSession(session, { loginName: user.loginName, organization, requestId })
  );
  logAuthEvent('signup.requested', 'success', { actor: hashActor(user.loginName), organization });
  // This is the only caller of registerAndLinkIdp (the IdP auto-create path) — no branch
  // check needed, reaching this line already means a brand-new account was just created.
  // Fired server-side (not the client trackAuthEvent) because this ceremony redirects the
  // browser straight through /authorize to the relying party without ever rendering a page.
  trackServerEvent('signup_submitted', { userId: user.id, properties: { channel: 'idp' } });
  // Thread the just-created session id so /authorize finishes the callback via resolveOidc's
  // explicit-sessionId hand-back (runCallback) instead of re-running decideAuthorize — without it
  // a brand-new IdP user completing a prompt=select_account / prompt=login ceremony loops straight
  // back to /accounts (or /login). Mirrors the password path's hand-back.
  const target = authorizeHandbackTarget(requestId, session.id);
  return { kind: 'redirect', target, sessions, loginName: user.loginName };
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

type RegisteredUser = Awaited<ReturnType<AuthProvider['register']>>;

// Short pause before the single retry below — long enough to give Zitadel's read replicas a
// beat to catch up, short enough not to meaningfully delay registration for the rare case it
// actually fires.
const REGISTER_RETRY_BACKOFF_MS = 300;

/**
 * Zitadel is eventually consistent: a step here (register(), or the createSession lookup inside
 * persistSession) can transiently return NOT_FOUND if it races a read replica that hasn't caught
 * up with a preceding write yet — the mirror image of the authorize-side read-after-write race
 * (see authorize.service.ts's healIfSessionDead retry). Retry the FAILED STEP exactly once, after
 * a short backoff, before letting the error propagate to the ALREADY_EXISTS enumeration-safe
 * catch in runEnumerationSafeRegister below.
 *
 * Deliberately narrow: only NOT_FOUND is retried, only once (a genuine not-found — e.g. the user
 * really doesn't exist — fails again immediately on the retry and propagates exactly as before,
 * never looping). ALREADY_EXISTS and every other code are rethrown untouched on the FIRST
 * attempt, preserving the existing enumeration-safe handling exactly.
 */
async function retryOnceIfNotFound<T>(
  step: () => Promise<T>,
  sleep: Sleep = realSleep
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'NOT_FOUND') {
      await sleep(REGISTER_RETRY_BACKOFF_MS);
      return step(); // single retry — if this also throws, it propagates to the caller as-is
    }
    throw error;
  }
}

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
      // retryOnceIfNotFound wraps EACH step independently (not the try block as a whole) so a
      // transient NOT_FOUND on register() doesn't also silently retry a persistSession() that
      // never ran, and vice versa.
      const user = await retryOnceIfNotFound(() => cfg.register());
      const sessions = await retryOnceIfNotFound(() => persistSession(user));
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
    const user = await retryOnceIfNotFound(() => cfg.register());
    const sessions = await retryOnceIfNotFound(() => persistSession(user));
    // Audit shape DIVERGES per path — parameterized, never collapsed to one event.
    cfg.noVerifySuccessAudit(user);
    // Fired server-side (not the client trackAuthEvent) because this path redirects the
    // browser straight to postRegisterStep's target without ever rendering the
    // "Check your email" page that carries the client-side TrackOnMount.
    trackServerEvent('signup_submitted', {
      userId: user.id,
      properties: { channel: cfg.hasPassword ? 'password' : 'passkey' },
    });
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

// Phase B: registerPasskeyFirst was retired here. The `passkey` intent now routes through
// registerEmailLinkSignup — one register path, one response shape (G7) — and the passkey
// nudge happens on /signup/complete after the address is proven.

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
  SignupSentWithSessionResult | SignupSentResult | SignupRedirectResult;

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
  // Resolve the effective registration org — org-first (explicit orgId from the ceremony URL),
  // then ZITADEL_DEFAULT_ORG_ID env pin, then the provider's instance Default Organization.
  // Raw `organization` is undefined on a bare (no ?organization=) flow, causing Zitadel's
  // FAILED_PRECONDITION on addHumanUser when no org is supplied to register().
  // createSession in runEnumerationSafeRegister also receives the resolved org via `organization`.
  const registrationOrg = await resolveOrg(provider, organization);

  return runEnumerationSafeRegister(provider, list, {
    email,
    organization: registrationOrg,
    requestId,
    deviceTrackingToken: input.deviceTrackingToken,
    userAgent: input.userAgent,
    requireVerification: input.requireVerification,
    hasPassword: true,
    // When verification is skipped (EMAIL_VERIFICATION=false on staging): pass emailVerified:true
    // so Zitadel marks the email verified in-place and sends nothing. Omit verifyUrlTemplate
    // entirely — passing it alongside emailVerified is redundant and risks triggering the sendCode
    // path in a future Zitadel version.
    //
    // When verification is required (the default/prod path): pass verifyUrlTemplate so Zitadel
    // sends the verification email to the user's address. emailVerified is omitted — the user
    // must click the link before their session is fully verified.
    register: () =>
      input.requireVerification
        ? provider.register({
            email,
            firstName,
            lastName,
            password,
            orgId: registrationOrg,
            // Steer the verification mail's link back to OUR /verify route. requestId rides
            // along so the post-verify step can resume an OIDC/SAML ceremony. Origin comes
            // from trusted config (PUBLIC_ORIGIN), NOT the Host header, to block injection.
            verifyUrlTemplate: verifyUrlTemplate({ origin, requestId }),
          })
        : provider.register({
            email,
            firstName,
            lastName,
            password,
            orgId: registrationOrg,
            // emailVerified:true → Zitadel marks verified immediately, sends no email.
            emailVerified: true,
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
  // Resolve the effective registration org — org-first (explicit orgId from the ceremony URL),
  // then ZITADEL_DEFAULT_ORG_ID env pin, then the provider's instance Default Organization.
  // Raw `organization` is undefined on a bare (no ?organization=) flow, causing Zitadel's
  // FAILED_PRECONDITION on addHumanUser when no org is supplied to register().
  const registrationOrg = await resolveOrg(provider, organization);
  try {
    await provider.register({
      email,
      firstName,
      lastName,
      orgId: registrationOrg,
      verifyUrlTemplate: signupCompleteUrlTemplate({ origin, requestId, organization }),
    });
  } catch (error) {
    if (!(error instanceof ProviderError && error.code === 'ALREADY_EXISTS')) throw error;
    // SQUATTING FIX (inherited bug): an unverified, factorless account holds this address
    // forever — the real owner's signup lands here every time and is silently dropped, so
    // they can never sign up. Resend verification so the address stays claimable by whoever
    // controls the inbox. A REAL account (any auth method enrolled) gets nothing.
    //
    // ENUMERATION SAFETY: both branches fall through to the identical response below. The
    // rate-limit skip is likewise silent. An attacker learns nothing without the inbox.
    // Residual, accepted in the spec: the resend branch makes an extra API call, so response
    // TIMING differs.
    await resendIfSquatted(provider, email, { origin, requestId, organization });
  }
  logAuthEvent('signup.requested', 'success', { actor: hashActor(email), organization });
  return { kind: 'sent', email };
}

async function resendIfSquatted(
  provider: AuthProvider,
  email: string,
  link: { origin: string; requestId?: string; organization?: string }
): Promise<void> {
  try {
    const user = await provider.findUser(email);
    if (!user) return;
    const methods = await provider.listAuthMethods(user.id);
    if (methods.length > 0) return; // a real account — stay silent
    if (!(await allowResend(email))) return; // mail-bombing guard — silent skip
    await provider.sendEmailCode(user.id, signupCompleteUrlTemplate(link));
  } catch {
    // Swallowed on purpose: this is a best-effort side effect on an already-generic response
    // path. An error here must never change what the caller returns, or it becomes the
    // enumeration oracle this whole function exists to avoid.
  }
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
