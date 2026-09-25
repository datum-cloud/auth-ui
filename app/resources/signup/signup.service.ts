// app/resources/signup/signup.service.ts
//
// Pass 2 extraction: the action BUSINESS logic for the signup domain — the
// register-and-link (IdP) compose, the password-first hand-off, the passwordless email-link
// register, and the password-set register, each with their enumeration-safe ALREADY_EXISTS
// handling and post-register routing. React rendering, CSRF, the final redirect()/data()
// wiring and cookie serialization stay in the route modules.
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
import { mailReturnTo } from '@/resources/shared/mail-return-to';
import { authorizeHandbackTarget, threadParams } from '@/resources/shared/next-step-params';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { postRegisterStep } from '@/resources/signup/post-register';
import { allowResend } from '@/resources/signup/signup-resend-limit';
import { resendVerification } from '@/resources/signup/verification-resend';
import {
  signupCompleteUrlTemplate,
  verifyUrlTemplate,
} from '@/resources/verify/verify-url-template';
import { env } from '@/server/infra/env.server';
import { sendVerificationMail } from '@/server/infra/verification-mail.server';
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
 * Enumeration-safe register flow for the with-password path (/signup/password).
 *
 * Kept as a named function rather than folded into its single caller: it holds the
 * read-after-write retry wiring and the ALREADY_EXISTS parity contract, which are the parts
 * that have to stay readable and separately testable.
 *
 * HISTORY — this was parameterized for TWO callers. The passkey-first path was retired in
 * Phase B (the passkey intent now routes through registerEmailLinkSignup), so `hasPassword`
 * and `noVerifySuccessAudit` were dropped: with one caller they were constants dressed as
 * config. `register` stays a callback because the caller picks between two different
 * provider.register payloads depending on requireVerification.
 *
 * The ALREADY_EXISTS branch returns the IDENTICAL response to the success branch when
 * verification is required, so a duplicate email is indistinguishable from a fresh signup.
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
    register: () => Promise<RegisteredUser>;
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
    // 'signup.created' (NOT 'signup.requested'), carrying userId and hashing loginName. This
    // was a caller-supplied callback while the passkey-first path emitted a different event;
    // that path is gone, so the one remaining shape is written out here directly.
    logAuthEvent('signup.created', 'success', {
      userId: user.id,
      actor: hashActor(user.loginName),
    });
    // Fired server-side (not the client trackAuthEvent) because this path redirects the
    // browser straight to postRegisterStep's target without ever rendering the
    // "Check your email" page that carries the client-side TrackOnMount.
    trackServerEvent('signup_submitted', {
      userId: user.id,
      properties: { channel: 'password' },
    });
    const target = postRegisterStep({
      hasPassword: true,
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
 * /signup/password register: register with a password, then apply enumeration-safe handling
 * via runEnumerationSafeRegister — the success path and the ALREADY_EXISTS path return the
 * IDENTICAL response when verification is required, so a duplicate email is indistinguishable
 * from a fresh signup.
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
    // When verification is skipped (AUTH_EMAIL_VERIFICATION_REQUIRED=false on staging): pass emailVerified:true
    // so Zitadel marks the email verified in-place and sends nothing. Omit verifyUrlTemplate
    // entirely — passing it alongside emailVerified is redundant and risks triggering the sendCode
    // path in a future Zitadel version.
    //
    // When verification is required (the default/prod path): pass returnCode so Zitadel hands
    // the plaintext code back on the result instead of emailing it itself — we deliver it
    // through our own pipeline (sendVerificationMail) below. emailVerified is omitted — the
    // user must submit the code before their session is fully verified.
    //
    // CRITICAL fallback (final-findings.md CRITICAL 1): auth-ui, zitadel-provider, and infra
    // deploy independently, and infra wires VERIFICATION_MAIL_URL only in SOME environments —
    // an auth-ui release can land before infra's URL is configured there. Unset MUST mean
    // "behave exactly as before this pipeline existed": ask Zitadel to send its own mail via
    // verifyUrlTemplate, rather than requesting returnCode and delivering the code nowhere.
    register: async () => {
      if (!input.requireVerification) {
        return provider.register({
          email,
          firstName,
          lastName,
          password,
          orgId: registrationOrg,
          // emailVerified:true → Zitadel marks verified immediately, sends no email.
          emailVerified: true,
        });
      }
      if (!env.VERIFICATION_MAIL_URL) {
        // Milo pipeline not configured in this environment — pre-Task-6 behavior: Zitadel
        // sends its own mail to a link that lands on OUR /verify route.
        return provider.register({
          email,
          firstName,
          lastName,
          password,
          orgId: registrationOrg,
          verifyUrlTemplate: verifyUrlTemplate({ origin, requestId }),
        });
      }
      const user = await provider.register({
        email,
        firstName,
        lastName,
        password,
        orgId: registrationOrg,
        returnCode: true,
      });
      // G7: sendVerificationMail NEVER throws and resolves false on a delivery
      // failure — that failure must NOT change the signup response (log-and-continue
      // is the whole contract; the user recovers via resend). See
      // verification-mail.server.ts.
      if (user.emailCode) {
        await sendVerificationMail({
          userId: user.id,
          code: user.emailCode,
          // Origin comes from trusted config (PUBLIC_ORIGIN), NOT the Host header, to
          // block injection — the same rule verifyUrlTemplate already followed.
          returnTo: mailReturnTo(origin, '/verify', {
            requestId,
            organization: registrationOrg,
          }),
        });
      }
      return user;
    },
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
}

/**
 * Passwordless email-link signup: register without a password and send ONE
 * verification email whose link targets /signup/complete (to prompt passkey setup).
 *
 * Enumeration-safe: a duplicate-email ALREADY_EXISTS error is caught and
 * silently discarded — the caller receives the IDENTICAL generic "sent" result
 * as a fresh signup, so account existence is not detectable.
 */
// No SessionEntry[] parameter, unlike its sibling register functions: this path deliberately
// creates NO session. The address is unproven until the emailed link is clicked, so the only
// place a session is minted is /signup/complete. Taking a session list here would invite a
// caller to assume otherwise.
export async function registerEmailLinkSignup(
  provider: AuthProvider,
  input: EmailLinkSignupInput
): Promise<SignupSentResult> {
  const { email, firstName, lastName, organization, requestId, origin } = input;
  // Resolve the effective registration org — org-first (explicit orgId from the ceremony URL),
  // then ZITADEL_DEFAULT_ORG_ID env pin, then the provider's instance Default Organization.
  // Raw `organization` is undefined on a bare (no ?organization=) flow, causing Zitadel's
  // FAILED_PRECONDITION on addHumanUser when no org is supplied to register().
  const registrationOrg = await resolveOrg(provider, organization);
  try {
    // CRITICAL fallback (final-findings.md CRITICAL 1): auth-ui, zitadel-provider, and infra
    // deploy independently, and infra wires VERIFICATION_MAIL_URL only in SOME environments —
    // an auth-ui release can land before infra's URL is configured there. Unset MUST mean
    // "behave exactly as before this pipeline existed": ask Zitadel to send its own mail via
    // verifyUrlTemplate, rather than requesting returnCode and delivering the code nowhere.
    if (!env.VERIFICATION_MAIL_URL) {
      // Pre-Task-6 behavior: Zitadel sends its own mail to a link landing on
      // /signup/complete (same destination signupCompleteUrlTemplate always built).
      await provider.register({
        email,
        firstName,
        lastName,
        orgId: registrationOrg,
        verifyUrlTemplate: signupCompleteUrlTemplate({
          origin,
          requestId,
          organization: registrationOrg,
        }),
      });
    } else {
      const user = await provider.register({
        email,
        firstName,
        lastName,
        orgId: registrationOrg,
        // returnCode: the code comes back in-band instead of Zitadel emailing it — delivered
        // through OUR pipeline (sendVerificationMail) below, same as registerWithPassword's
        // requireVerification arm and resendIfSquatted.
        returnCode: true,
      });
      if (user.emailCode) {
        // G7: sendVerificationMail NEVER throws and resolves false on a delivery failure — that
        // failure must NOT change the signup response (log-and-continue is the whole contract;
        // the user recovers via resend). See verification-mail.server.ts.
        await sendVerificationMail({
          userId: user.id,
          code: user.emailCode,
          // SAME destination + params signupCompleteUrlTemplate used to build for Zitadel's own
          // sendCode path (requestId, organization, next=passkey) — just without the
          // {{.Code}}/{{.UserID}} placeholders, which the milo webhook appends itself.
          //
          // organization is the RESOLVED registrationOrg, NOT the raw (possibly undefined on a
          // bare flow) `organization` input — unlike signupCompleteUrlTemplate's
          // `organization={{.OrgID}}`, which was a PLACEHOLDER Zitadel substituted with the
          // resolved org at send time regardless of what this variable held, verificationReturnTo
          // has no such substitution pass: it emits exactly what it's handed. Passing the raw
          // value here silently dropped `organization` from the link on a bare (no ?organization=)
          // signup, which made completeEmailLinkSignup's createSession lose org scoping.
          returnTo: mailReturnTo(origin, '/signup/complete', {
            requestId,
            organization: registrationOrg,
            next: 'passkey',
          }),
        });
      }
    }
  } catch (error) {
    if (!(error instanceof ProviderError && error.code === 'ALREADY_EXISTS')) throw error;
    // An unverified, factorless account holds this address forever, so the real owner's signup is
    // silently dropped every time. Resend so the address stays claimable by whoever controls the
    // inbox. organization must be the RESOLVED registrationOrg or the emailed link loses it.
    const verdict = await resendIfSquatted(provider, email, {
      origin,
      requestId,
      organization: registrationOrg,
    });

    // DELIBERATE enumeration disclosure, and ONLY for 'enrolled'. Squatted must stay generic:
    // nobody can sign in to a credential-less account, so telling the real owner it is "already
    // registered" locks them out permanently — the bug the resend above exists to fix. 'unknown'
    // stays generic too, so a provider outage cannot manufacture a false "taken" error.
    // Boundary asserted by enumeration-parity-signup.cy.ts.
    if (verdict === 'enrolled') {
      logAuthEvent('signup.requested', 'failure', {
        actor: hashActor(email),
        organization,
        reason: 'already_exists',
      });
      throw new ProviderError(
        'ALREADY_EXISTS',
        'An account already exists for this address',
        false
      );
    }
  }
  logAuthEvent('signup.requested', 'success', { actor: hashActor(email), organization });
  return { kind: 'sent', email };
}

/**
 * What an ALREADY_EXISTS turned out to mean, so the caller can decide whether to disclose.
 * 'squatted' (factorless, verification resent) and 'unknown' (lookup failed) MUST stay generic;
 * only 'enrolled' is safe to disclose.
 */
type SquatVerdict = 'squatted' | 'enrolled' | 'unknown';

async function resendIfSquatted(
  provider: AuthProvider,
  email: string,
  // `organization` MUST be the caller's already-RESOLVED registrationOrg, not a raw/possibly-
  // undefined route param — verificationReturnTo emits it verbatim into `returnTo` (no Zitadel
  // placeholder substitution happens here), so an unresolved value would silently drop
  // organization from the emailed link on a bare (no ?organization=) signup.
  link: { origin: string; requestId?: string; organization?: string }
): Promise<SquatVerdict> {
  try {
    // Scoped to the org the register targeted. Unscoped, this resolves a DIFFERENT account than
    // the one that raised ALREADY_EXISTS and the verdict is computed for the wrong user — a
    // factorless address classified 'enrolled' off a namesake elsewhere is the permanent lockout
    // the squatted case exists to prevent.
    const user = await provider.findUser(email, link.organization);
    // No user behind an ALREADY_EXISTS is a contradiction (a race, or a provider quirk).
    // Treat it as unknown rather than asserting either way.
    if (!user) return 'unknown';
    const methods = await provider.listAuthMethods(user.id);
    if (methods.length > 0) return 'enrolled'; // a real account — caller may disclose
    if (!(await allowResend(email))) return 'squatted'; // mail-bombing guard — silent skip
    // The send itself lives in resendVerification, shared with /recover's class-(d) branch so the
    // two doors cannot drift. The limiter stays HERE (above): one per-address budget across both.
    // 'already_verified' is the rare verified-but-methodless account; it keeps today's behaviour
    // of staying generic rather than disclosing anything about it.
    if ((await resendVerification(provider, user, link)) === 'already_verified') return 'unknown';
    return 'squatted';
  } catch (error) {
    // The RESULT is swallowed on purpose: a lookup/resend fault must not decide what the caller
    // returns. It reports 'unknown', which the caller treats as "do not disclose" — so an outage
    // degrades to the old generic response instead of inventing an "already registered" error
    // for an address that may be free.
    //
    // The FAILURE is still audited. Total silence made a broken resend indistinguishable from a
    // deliberate skip, so an outage stranding every squatted address would be invisible to
    // operators. This audit is likewise server-side and cannot leak into the response.
    logAuthEvent('signup_verification_resent', 'failure', {
      actor: hashActor(email),
      reason: error instanceof ProviderError ? error.code : 'UNKNOWN',
    });
    return 'unknown';
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
  // checkAfter=false + returnTo: end at the signup terminal rather than running a ceremony the
  // user did not ask for. Enrolling a passkey adds no factor to the session, whose only factor is
  // the otpEmail proven above — which primaryFresh does not count — so post-enrollment routing
  // originally sent the user to /login/password, a password they never set. returnTo is
  // re-validated on the enroll POST.
  params.set('checkAfter', 'false');
  params.set('returnTo', `/signup/success?${threadParams(loginName, requestId, organization)}`);

  return { kind: 'redirect', target: `/setup/passkey?${params.toString()}`, sessions };
}

// Re-exported so callers/tests can reach post-register routing through the barrel.
export { postRegisterStep };
export type { PostRegisterInput } from '@/resources/signup/post-register';
