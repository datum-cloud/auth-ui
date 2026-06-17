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
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { addSession, type SessionEntry } from '@/modules/auth/session/cookie';
import { ProviderError } from '@/modules/auth/types';
import { postRegisterStep } from '@/resources/signup/post-register';
import { verifyUrlTemplate } from '@/resources/verify/verify-url-template';
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
}

/**
 * Phase 4 register-and-link: compose register → addIdpLink → createSession in one
 * logical step (route/flow level, not an AuthProvider method). IdP users are
 * passwordless — they skip the /signup/password path.
 *
 * CODE-MIN-04: link explicitly via addIdpLink — RegisterInput.idpLink is a dead
 * field no provider reads, so passing it to register() was a confusing no-op.
 * addIdpLink is the single, real link path.
 */
export async function registerAndLinkIdp(
  provider: AuthProvider,
  list: SessionEntry[],
  input: SignupIdpLinkInput
): Promise<SignupRedirectResult> {
  const { email, firstName, lastName, organization, requestId } = input;
  const idpLink = {
    idpId: input.idpId,
    idpUserId: input.idpUserId,
    idpUserName: input.idpUserName,
  };
  const user = await provider.register({ email, firstName, lastName, orgId: organization });
  await provider.addIdpLink(user.id, idpLink);
  const session = await provider.createSession(
    { idpIntent: { idpIntentId: input.idpIntentId, idpIntentToken: input.idpIntentToken } },
    { orgId: organization, requestId, userId: user.id }
  );
  const sessions = addSession(list, {
    id: session.id,
    token: session.token,
    loginName: user.loginName,
    organization,
    creationTs: session.changedAt,
    expirationTs: session.expiresAt,
    changeTs: session.changedAt,
    requestId,
  });
  logAuthEvent('signup.requested', 'success', { actor: hashActor(user.loginName), organization });
  const target = requestId ? `/authorize?requestId=${encodeURIComponent(requestId)}` : '/signed-in';
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
}

export type PasskeyFirstRegisterResult =
  | SignupSentWithSessionResult
  | SignupSentResult
  | SignupRedirectResult;

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
  const { email, firstName, lastName, organization, requestId, origin, deviceTrackingToken } = input;
  const sessionMetadata = deviceTrackingToken
    ? { [MAXMIND_TRACKING_TOKEN_METADATA_KEY]: deviceTrackingToken }
    : undefined;

  if (input.requireVerification) {
    try {
      const user = await provider.register({
        email,
        firstName,
        lastName,
        orgId: organization,
        verifyUrlTemplate: verifyUrlTemplate({ origin, requestId }),
      });
      const session = await provider.createSession(
        {},
        { orgId: organization, requestId, userId: user.id, metadata: sessionMetadata }
      );
      const sessions = addSession(list, {
        id: session.id,
        token: session.token,
        loginName: user.loginName,
        organization,
        creationTs: session.changedAt,
        expirationTs: session.expiresAt,
        changeTs: session.changedAt,
        requestId,
      });
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
    const user = await provider.register({ email, firstName, lastName, orgId: organization });
    const session = await provider.createSession(
      {},
      { orgId: organization, requestId, userId: user.id, metadata: sessionMetadata }
    );
    const sessions = addSession(list, {
      id: session.id,
      token: session.token,
      loginName: user.loginName,
      organization,
      creationTs: session.changedAt,
      expirationTs: session.expiresAt,
      changeTs: session.changedAt,
      requestId,
    });
    logAuthEvent('signup.requested', 'success', { actor: hashActor(email), organization });
    const target = postRegisterStep({
      hasPassword: false,
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
  const { email, firstName, lastName, password, organization, requestId, origin, deviceTrackingToken } =
    input;
  const sessionMetadata = deviceTrackingToken
    ? { [MAXMIND_TRACKING_TOKEN_METADATA_KEY]: deviceTrackingToken }
    : undefined;

  // Steer the verification mail's link back to OUR /verify route (raw provider
  // placeholders, filled by Zitadel). requestId rides along so the post-verify step
  // can resume an OIDC/SAML ceremony. The origin comes from trusted config
  // (PUBLIC_ORIGIN), NOT the request Host header, to block Host-header injection.
  const tmpl = verifyUrlTemplate({ origin, requestId });

  const register = () =>
    provider.register({
      email,
      firstName,
      lastName,
      password,
      orgId: organization,
      verifyUrlTemplate: tmpl,
    });

  if (input.requireVerification) {
    try {
      const user = await register();
      const session = await provider.createSession(
        {},
        { orgId: organization, requestId, userId: user.id, metadata: sessionMetadata }
      );
      const sessions = addSession(list, {
        id: session.id,
        token: session.token,
        loginName: user.loginName,
        organization,
        creationTs: session.changedAt,
        expirationTs: session.expiresAt,
        changeTs: session.changedAt,
        requestId,
      });
      logAuthEvent('signup.requested', 'success', { actor: hashActor(email), organization });
      return { kind: 'sent-with-session', email, sessions };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'ALREADY_EXISTS') {
        // ENUMERATION SAFETY: same audit event + identical response as the success path
        // (never surface error.message — raw "User already exists" leaks account existence).
        logAuthEvent('signup.requested', 'success', { actor: hashActor(email) });
        return { kind: 'sent', email };
      }
      throw error;
    }
  }

  // Verification not required: register and route forward; duplicate still generic.
  try {
    const user = await register();
    const session = await provider.createSession(
      {},
      { orgId: organization, requestId, userId: user.id, metadata: sessionMetadata }
    );
    const sessions = addSession(list, {
      id: session.id,
      token: session.token,
      loginName: user.loginName,
      organization,
      creationTs: session.changedAt,
      expirationTs: session.expiresAt,
      changeTs: session.changedAt,
      requestId,
    });
    logAuthEvent('signup.created', 'success', {
      userId: user.id,
      actor: hashActor(user.loginName),
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
      logAuthEvent('signup.requested', 'success', { actor: hashActor(email) });
      return { kind: 'sent', email };
    }
    throw error;
  }
}

// Re-exported so callers/tests can reach post-register routing through the barrel.
export { postRegisterStep };
export type { PostRegisterInput } from '@/resources/signup/post-register';
