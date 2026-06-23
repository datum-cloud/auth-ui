// app/resources/webauthn/webauthn.service.ts
//
// Pass 2 extraction: the loader/action BUSINESS logic for the webauthn domain.
// Two ceremonies live here:
//   - VERIFY (assertion): /login/{passkey,security-key} — request an assertion
//     challenge, then verify the returned credential and advance the session.
//   - SETUP (attestation): /setup/{passkey,security-key} — fetch an attestation
//     challenge, then verify the enrollment and advance the session.
//
// Every function takes a provider + already-read sessions + plain inputs and
// returns a typed result. Request parsing, CSRF, cookie I/O, the publicKey-inner
// unwrap for the WebAuthnButton, React rendering, and the route's redirect()/data()
// wiring all stay in the route modules.
//
// The browser-side marshalling helpers (webauthn.ts) were relocated into this
// folder during Pass 1; the barrel (index.ts) re-exports them and the verify
// factory so callers/tests reach the whole domain through one specifier.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { byLoginName, addSession, type SessionEntry } from '@/modules/auth/session/cookie';
import type { Session } from '@/modules/auth/types';
import { ProviderError } from '@/modules/auth/types';
import { nextStepWithParams } from '@/resources/shared/next-step-params';
import { logAuthEvent, hashActor } from '@/server/observability';

// ── shared: derive the post-ceremony next step from a session ─────────────────

interface NextStepFromSessionInput {
  session: Session;
  methods: Awaited<ReturnType<AuthProvider['listAuthMethods']>>;
  settings: Awaited<ReturnType<AuthProvider['getLoginSettings']>>;
  loginName: string;
  requestId?: string;
  organization?: string;
}

/**
 * passkey.userVerified drives the passwordless-shortcut in nextStep → /signed-in.
 * Centralises the identical next-step derivation shared by verify + setup actions.
 */
function nextStepFromSession({
  session,
  methods,
  settings,
  loginName,
  requestId,
  organization,
}: NextStepFromSessionInput): string {
  return nextStepWithParams({
    factors: session.factors,
    settings,
    enrolledMethods: methods,
    loginName: session.user?.loginName ?? loginName,
    userVerified: session.factors.passkey?.userVerified ?? false,
    mfaInitSkippedAt: session.user?.mfaInitSkippedAt,
    requestId,
    organization,
  });
}

// ── VERIFY (assertion) loader ─────────────────────────────────────────────────

export interface WebAuthnChallengeConfig {
  /** Passed to the FIDO2 challenge; 'required' for passkeys, 'discouraged' for U2F security keys. */
  userVerificationRequirement: 'required' | 'discouraged';
  /** Audit event name for the challenge request failure. */
  challengeAuditEvent: 'mfa_passkey_challenge' | 'mfa_u2f_challenge';
}

export interface WebAuthnChallengeInput {
  loginName: string;
  organization?: string;
  /** Request hostname — the FIDO2 relying-party domain for the challenge. */
  domain: string;
}

/** Resolve away from the verify screen (no active session for this loginName). */
export interface WebAuthnChallengeRedirect {
  kind: 'redirect';
  target: string;
}

/**
 * The challenge data the verify screen renders. publicKeyCredentialRequestOptions is
 * null when the challenge request failed — non-fatal; the button shows an error on click.
 */
export interface WebAuthnChallengeData {
  kind: 'challenge';
  publicKeyCredentialRequestOptions: unknown;
}

export type WebAuthnChallengeResult = WebAuthnChallengeRedirect | WebAuthnChallengeData;

/**
 * Request a WebAuthn assertion challenge for an already-read sessions list.
 *
 * Guard: require an active session for this loginName → otherwise redirect('/login').
 * Then updateSession with a webAuthN challenge parameterised by userVerificationRequirement.
 * A challenge failure is NOT fatal — log the configured failure audit and return a null
 * options object so the screen still renders (the browser surfaces an error on click).
 *
 * The CSRF token + Set-Cookie header are the route's concern, so they are NOT part of
 * this result.
 */
export async function requestWebAuthnChallenge(
  provider: AuthProvider,
  sessions: SessionEntry[],
  cfg: WebAuthnChallengeConfig,
  { loginName, organization, domain }: WebAuthnChallengeInput
): Promise<WebAuthnChallengeResult> {
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return { kind: 'redirect', target: '/login' };

  let publicKeyCredentialRequestOptions: unknown = null;
  try {
    const session = await provider.updateSession(entry.id, entry.token, {
      challenges: {
        webAuthN: {
          domain,
          userVerificationRequirement: cfg.userVerificationRequirement,
        },
      },
    });
    publicKeyCredentialRequestOptions =
      session.challenges?.webAuthN?.publicKeyCredentialRequestOptions ?? null;
  } catch {
    logAuthEvent(cfg.challengeAuditEvent, 'failure', { loginName });
    // Challenge failure is not fatal — the browser will show an error when the button is clicked.
  }

  return { kind: 'challenge', publicKeyCredentialRequestOptions };
}

// ── VERIFY (assertion) action ─────────────────────────────────────────────────

export interface WebAuthnVerifyAuditConfig {
  /** Audit event name for the assertion attempt (success / failure). */
  auditEvent: 'mfa_passkey' | 'mfa_u2f';
}

export interface WebAuthnVerifyInput {
  /** Raw JSON string of the assertion credential, as posted by the form. */
  credential: string;
  loginName: string;
  requestId?: string;
  organization?: string;
}

export type WebAuthnVerifyError = 'SESSION_EXPIRED' | 'INVALID_INPUT' | 'INVALID_CREDENTIALS';

export type WebAuthnVerifyResult =
  | {
      ok: true;
      target: string;
      /** The (potentially rotated) sessions list to write back to the cookie. */
      sessions: SessionEntry[];
    }
  | { ok: false; error: WebAuthnVerifyError };

/**
 * Verify a WebAuthn assertion for an already-read sessions list.
 *
 * Guard: active session required → SESSION_EXPIRED (with a session_expired audit failure).
 * Parse the credential JSON → INVALID_INPUT on malformed JSON. updateSession with the
 * assertion data; an INVALID_CREDENTIALS ProviderError maps to the typed error, any other
 * failure (after logging) re-throws.
 *
 * On success: emit the success audit, write the rotated session token back into the sessions
 * list (returned for the route to serialize), derive the next step, and return both.
 */
export async function verifyWebAuthnAssertion(
  provider: AuthProvider,
  sessions: SessionEntry[],
  cfg: WebAuthnVerifyAuditConfig,
  { credential, loginName, requestId, organization }: WebAuthnVerifyInput
): Promise<WebAuthnVerifyResult> {
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) {
    logAuthEvent(cfg.auditEvent, 'failure', { loginName, reason: 'session_expired' });
    return { ok: false, error: 'SESSION_EXPIRED' };
  }

  let credentialData: unknown;
  try {
    credentialData = JSON.parse(credential);
  } catch {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  let session: Session;
  try {
    session = await provider.updateSession(entry.id, entry.token, {
      webAuthN: { credentialAssertionData: credentialData },
    });
  } catch (err) {
    logAuthEvent(cfg.auditEvent, 'failure', { loginName });
    if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
      return { ok: false, error: 'INVALID_CREDENTIALS' };
    }
    throw err;
  }

  logAuthEvent(cfg.auditEvent, 'success', {
    userId: session.user?.id,
    sessionId: session.id,
  });

  // Write back the (potentially rotated) session token.
  const next = addSession(sessions, {
    ...entry,
    token: session.token,
    changeTs: session.changedAt,
    expirationTs: session.expiresAt,
  });

  const userId = session.user?.id ?? '';
  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(userId),
    provider.getLoginSettings(organization),
  ]);

  const target = nextStepFromSession({
    session,
    methods,
    settings,
    loginName,
    requestId,
    organization,
  });

  return { ok: true, target, sessions: next };
}

// ── SETUP (attestation) shared session/user resolution ────────────────────────

interface ResolvedEnrollee {
  entry: SessionEntry;
  userId: string;
}

/**
 * Resolve the active session + userId for an enrollment flow.
 *
 * SessionEntry carries no userId field, so the user is resolved via findUser. Either guard
 * failing yields the typed sentinel the caller maps to its own redirect/typed error.
 */
async function resolveEnrollee(
  provider: AuthProvider,
  sessions: SessionEntry[],
  loginName: string,
  organization?: string
): Promise<ResolvedEnrollee | null> {
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return null;

  const user = await provider.findUser(loginName, organization);
  if (!user) return null;

  return { entry, userId: user.id };
}

// ── SETUP: passkey attestation loader ─────────────────────────────────────────

export interface AttestationLoaderInput {
  loginName: string;
  organization?: string;
  /** Request hostname — the FIDO2 relying-party domain for the attestation challenge. */
  domain: string;
}

/** Resolve away from the setup screen (no active session, or no resolvable user). */
export interface AttestationLoaderRedirect {
  kind: 'redirect';
  target: string;
}

/**
 * The attestation challenge data the passkey-setup screen renders.
 * passkeyId/publicKey are null and challengeFailed is true when the challenge could not
 * be fetched — non-fatal; the button shows an error on click and the screen warns up front.
 */
export interface PasskeyAttestationData {
  kind: 'challenge';
  passkeyId: string | null;
  publicKeyCredentialCreationOptions: unknown;
  challengeFailed: boolean;
}

export type PasskeyAttestationResult = AttestationLoaderRedirect | PasskeyAttestationData;

/**
 * Fetch a passkey attestation challenge for an already-read sessions list.
 *
 * Guard: active session + resolvable user required → redirect('/login') otherwise.
 * Steps 1–2: get a registration link, then fetch attestation options. On failure
 * (provider unreachable, token expired, etc.) degrade gracefully: log a TYPED audit
 * code with a PSEUDONYMIZED actor, surface challengeFailed=true,
 * and leave publicKey null.
 *
 * Returns the RAW publicKeyCredentialCreationOptions; the route unwraps the inner
 * publicKey object for the WebAuthnButton (non-serializable concerns stay in the route).
 */
export async function requestPasskeyAttestation(
  provider: AuthProvider,
  sessions: SessionEntry[],
  { loginName, organization, domain }: AttestationLoaderInput
): Promise<PasskeyAttestationResult> {
  const resolved = await resolveEnrollee(provider, sessions, loginName, organization);
  if (!resolved) return { kind: 'redirect', target: '/login' };

  const { userId } = resolved;

  let passkeyId: string | null = null;
  let publicKeyCredentialCreationOptions: unknown = null;
  let challengeFailed = false;
  try {
    const { code } = await provider.passkeyRegisterLink(userId);
    // registerPasskey returns WebAuthnCreationOptions — no boundary cast needed.
    const { passkeyId: id, publicKeyCredentialCreationOptions: options } =
      await provider.registerPasskey(userId, code, domain);
    passkeyId = id;
    publicKeyCredentialCreationOptions = options;
  } catch (err) {
    // Don't discard the cause — log a typed code and a pseudonymized actor.
    logAuthEvent('mfa_enroll_challenge', 'failure', {
      actor: hashActor(loginName),
      factor: 'passkey',
      code: err instanceof ProviderError ? err.code : 'UNKNOWN',
    });
    challengeFailed = true;
  }

  return { kind: 'challenge', passkeyId, publicKeyCredentialCreationOptions, challengeFailed };
}

// ── SETUP: security-key (U2F) attestation loader ──────────────────────────────

/**
 * The attestation challenge data the security-key-setup screen renders.
 * u2fId/publicKey are null when the challenge could not be fetched — non-fatal; the
 * button surfaces the inline error on click.
 */
export interface U2FAttestationData {
  kind: 'challenge';
  u2fId: string | null;
  publicKeyCredentialCreationOptions: unknown;
}

export type U2FAttestationResult = AttestationLoaderRedirect | U2FAttestationData;

/**
 * Fetch a U2F (security-key) attestation challenge for an already-read sessions list.
 *
 * Guard: active session + resolvable user required → redirect('/login') otherwise.
 * Fetch U2F attestation options; degrade gracefully on failure (log a failure audit,
 * leave publicKey null — the button surfaces the inline error on click).
 *
 * Returns the RAW publicKeyCredentialCreationOptions; the route unwraps the inner
 * publicKey object for the WebAuthnButton.
 */
export async function requestU2FAttestation(
  provider: AuthProvider,
  sessions: SessionEntry[],
  { loginName, organization, domain }: AttestationLoaderInput
): Promise<U2FAttestationResult> {
  const resolved = await resolveEnrollee(provider, sessions, loginName, organization);
  if (!resolved) return { kind: 'redirect', target: '/login' };

  const { userId } = resolved;

  let u2fId: string | null = null;
  let publicKeyCredentialCreationOptions: unknown = null;
  try {
    // registerU2F returns U2FCreationOptions — no boundary cast needed.
    const { u2fId: id, publicKeyCredentialCreationOptions: options } = await provider.registerU2F(
      userId,
      domain
    );
    u2fId = id;
    publicKeyCredentialCreationOptions = options;
  } catch {
    logAuthEvent('mfa_enroll_challenge', 'failure', { loginName, factor: 'u2f' });
    // publicKey stays null — WebAuthnButton surfaces the inline error on click.
  }

  return { kind: 'challenge', u2fId, publicKeyCredentialCreationOptions };
}

// ── SETUP enrollment action (shared shape) ────────────────────────────────────

export type EnrollError = 'INVALID_INPUT' | 'SESSION_EXPIRED' | 'INVALID_CREDENTIALS';

export type EnrollResult = { ok: true; target: string } | { ok: false; error: EnrollError };

export interface PasskeyEnrollInput {
  /** Raw JSON string of the attestation credential, as posted by the form. */
  credential: string;
  passkeyId: string;
  loginName: string;
  requestId?: string;
  organization?: string;
  /** When 'true', route straight into the matching verify screen after enrollment. */
  checkAfter?: 'true' | 'false';
}

/**
 * Verify a passkey enrollment for an already-read sessions list.
 *
 * Guard: active session + resolvable user required → SESSION_EXPIRED otherwise. Parse the
 * credential JSON → INVALID_INPUT on malformed JSON. verifyPasskey; an INVALID_CREDENTIALS
 * ProviderError maps to the typed error (after a failure audit), any other failure re-throws.
 *
 * On success: emit the success audit. checkAfter='true' routes straight into /login/passkey.
 * Otherwise derive the next step from the current session state (SESSION_EXPIRED if the
 * session has since died).
 */
export async function verifyPasskeyEnrollment(
  provider: AuthProvider,
  sessions: SessionEntry[],
  { credential, passkeyId, loginName, requestId, organization, checkAfter }: PasskeyEnrollInput
): Promise<EnrollResult> {
  const resolved = await resolveEnrollee(provider, sessions, loginName, organization);
  if (!resolved) return { ok: false, error: 'SESSION_EXPIRED' };

  const { entry, userId } = resolved;

  let parsedCredential: unknown;
  try {
    parsedCredential = JSON.parse(credential) as unknown;
  } catch {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  try {
    await provider.verifyPasskey(userId, passkeyId, parsedCredential);
  } catch (err) {
    logAuthEvent('mfa_enroll', 'failure', { userId, factor: 'passkey' });
    if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
      return { ok: false, error: 'INVALID_CREDENTIALS' };
    }
    throw err;
  }

  logAuthEvent('mfa_enroll', 'success', { userId, factor: 'passkey' });

  // checkAfter=true: immediately route into the matching verify screen.
  if (checkAfter === 'true') {
    const params = new URLSearchParams({ loginName });
    if (requestId) params.set('requestId', requestId);
    if (organization) params.set('organization', organization);
    return { ok: true, target: `/login/passkey?${params.toString()}` };
  }

  // Normal post-enrollment routing: derive next step from current session state.
  const session = await provider.getSession(entry.id, entry.token);
  if (!session) return { ok: false, error: 'SESSION_EXPIRED' };

  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(userId),
    provider.getLoginSettings(organization),
  ]);

  const target = nextStepFromSession({
    session,
    methods,
    settings,
    loginName,
    requestId,
    organization,
  });

  return { ok: true, target };
}

export interface U2FEnrollInput {
  /** Raw JSON string of the attestation credential, as posted by the form. */
  credential: string;
  u2fId: string;
  loginName: string;
  requestId?: string;
  organization?: string;
  /** When 'true', route straight into the matching verify screen after enrollment. */
  checkAfter?: 'true' | 'false';
}

/**
 * Verify a U2F (security-key) enrollment for an already-read sessions list.
 *
 * Guard: active session + resolvable user required → SESSION_EXPIRED otherwise. Parse the
 * credential JSON → INVALID_INPUT on malformed JSON. Zitadel verifyU2F reads
 * { u2fId, publicKeyCredential, tokenName } off the cred object. An INVALID_CREDENTIALS
 * ProviderError maps to the typed error (after a failure audit), any other failure re-throws.
 *
 * On success: emit the success audit. checkAfter='true' routes straight into
 * /login/security-key. Otherwise derive the next step from the current session state
 * (SESSION_EXPIRED if the session has since died).
 */
export async function verifyU2FEnrollment(
  provider: AuthProvider,
  sessions: SessionEntry[],
  { credential, u2fId, loginName, requestId, organization, checkAfter }: U2FEnrollInput
): Promise<EnrollResult> {
  const resolved = await resolveEnrollee(provider, sessions, loginName, organization);
  if (!resolved) return { ok: false, error: 'SESSION_EXPIRED' };

  const { entry, userId } = resolved;

  let parsedCredential: unknown;
  try {
    parsedCredential = JSON.parse(credential) as unknown;
  } catch {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  // Zitadel verifyU2F reads { u2fId, publicKeyCredential, tokenName } off the cred object.
  const credPayload = { u2fId, publicKeyCredential: parsedCredential, tokenName: '' };

  try {
    await provider.verifyU2F(userId, credPayload);
  } catch (err) {
    logAuthEvent('mfa_enroll', 'failure', { userId, factor: 'u2f' });
    if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
      return { ok: false, error: 'INVALID_CREDENTIALS' };
    }
    throw err;
  }

  logAuthEvent('mfa_enroll', 'success', { userId, factor: 'u2f' });

  // checkAfter=true: immediately route into the matching verify screen.
  if (checkAfter === 'true') {
    const params = new URLSearchParams({ loginName });
    if (requestId) params.set('requestId', requestId);
    if (organization) params.set('organization', organization);
    return { ok: true, target: `/login/security-key?${params.toString()}` };
  }

  // Normal post-enrollment routing: derive next step from current session state.
  const session = await provider.getSession(entry.id, entry.token);
  if (!session) return { ok: false, error: 'SESSION_EXPIRED' };

  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(userId),
    provider.getLoginSettings(organization),
  ]);

  const target = nextStepFromSession({
    session,
    methods,
    settings,
    loginName,
    requestId,
    organization,
  });

  return { ok: true, target };
}
