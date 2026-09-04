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
import {
  nextStepFromSession as sharedNextStepFromSession,
  threadParams,
  loginBounceTarget,
} from '@/resources/shared/next-step-params';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { resolveSessionUser } from '@/resources/shared/resolve-session-user';
import { isSudoFresh } from '@/resources/shared/sudo';
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
 * Thin webauthn-local wrapper over the shared assembly: resolves the webauthn divergence
 * (prefer the session user's loginName; read mfaInitSkippedAt off the session user) and
 * delegates the rest to the shared helper.
 */
function nextStepFromSession({
  session,
  methods,
  settings,
  loginName,
  requestId,
  organization,
}: NextStepFromSessionInput): string {
  return sharedNextStepFromSession({
    session,
    methods,
    settings,
    loginName: session.user?.loginName ?? loginName,
    mfaInitSkippedAt: session.user?.mfaInitSkippedAt,
    requestId,
    organization,
  });
}

// ── VERIFY (assertion) challenge — extracted ──────────────────────────────────
// Lives in webauthn-challenge.ts to keep this file under the size ceiling; re-exported here so
// the barrel and existing direct importers are unchanged.
export {
  requestWebAuthnChallenge,
  armUserBoundChallenge,
} from '@/resources/webauthn/webauthn-challenge';
export type {
  WebAuthnChallengeConfig,
  WebAuthnChallengeInput,
  WebAuthnChallengeRedirect,
  WebAuthnChallengeData,
  WebAuthnChallengeResult,
  StaleSessionRecovery,
  ArmedUserBoundChallenge,
} from '@/resources/webauthn/webauthn-challenge';

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
    logAuthEvent(cfg.auditEvent, 'failure', { actor: hashActor(loginName) });
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
  // Org-first: an explicit org wins, else the default org (old app's `organization ?? getDefaultOrg()`).
  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(userId),
    provider.getLoginSettings(await resolveOrg(provider, organization)),
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

// ── SETUP: passkey attestation loader ─────────────────────────────────────────

export interface AttestationLoaderInput {
  loginName: string;
  requestId?: string;
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
 * Guard: active session + resolvable user required → otherwise bounce to
 * loginBounceTarget(requestId, organization) (i.e. /login, carrying ceremony context when present).
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
  { loginName, requestId, organization, domain }: AttestationLoaderInput
): Promise<PasskeyAttestationResult> {
  const resolved = await resolveSessionUser(provider, sessions, loginName, organization);
  if (!resolved) {
    // Was a SILENT 302: issue #1485 reproduced for a week with nothing but health probes in the
    // pod logs, because this bounce left no trace. A typed event makes the next one greppable.
    logAuthEvent('mfa_enroll_challenge', 'failure', {
      actor: hashActor(loginName),
      factor: 'passkey',
      reason: 'session_expired',
    });
    return { kind: 'redirect', target: loginBounceTarget(requestId, organization) };
  }

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
 * Guard: active session + resolvable user required → otherwise bounce to
 * loginBounceTarget(requestId, organization) (i.e. /login, carrying ceremony context when present).
 * Fetch U2F attestation options; degrade gracefully on failure (log a failure audit,
 * leave publicKey null — the button surfaces the inline error on click).
 *
 * Returns the RAW publicKeyCredentialCreationOptions; the route unwraps the inner
 * publicKey object for the WebAuthnButton.
 */
export async function requestU2FAttestation(
  provider: AuthProvider,
  sessions: SessionEntry[],
  { loginName, requestId, organization, domain }: AttestationLoaderInput
): Promise<U2FAttestationResult> {
  const resolved = await resolveSessionUser(provider, sessions, loginName, organization);
  if (!resolved) {
    logAuthEvent('mfa_enroll_challenge', 'failure', {
      actor: hashActor(loginName),
      factor: 'u2f',
      reason: 'session_expired',
    });
    return { kind: 'redirect', target: loginBounceTarget(requestId, organization) };
  }

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

export type EnrollError =
  | 'INVALID_INPUT'
  | 'SESSION_EXPIRED'
  | 'INVALID_CREDENTIALS'
  // Passkey enrollment requires a fresh authentication factor (sudo).
  | 'SUDO_REQUIRED';

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
  /** User-typed or AAGUID-derived label, set-once via verifyPasskey. */
  passkeyName?: string;
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
/**
 * Per-factor enrollment config — the only points where passkey and U2F enrollment
 * diverge. Mirrors the cfg-object pattern of requestWebAuthnChallenge / verifyWebAuthnAssertion.
 *
 *  - `factor`: audit-event factor field ('passkey' vs 'u2f').
 *  - `verify`: the provider call — passkey verifies (userId, passkeyId, cred) directly;
 *     U2F wraps the parsed credential into { u2fId, publicKeyCredential, tokenName: '' }.
 *  - `checkAfterPath`: the verify screen routed into when checkAfter='true'.
 */
interface EnrollmentConfig {
  factor: 'passkey' | 'u2f';
  verify: (provider: AuthProvider, userId: string, parsedCredential: unknown) => Promise<void>;
  checkAfterPath: '/login/passkey' | '/login/security-key';
  /**
   * Require a fresh authentication factor (sudo window) on the ACTIVE
   * session before accepting the enrollment. Server-side enforcement — deep-linking
   * /setup/passkey with a stale session is rejected here regardless of entry route.
   * Passkey only; U2F enrollment is unchanged.
   */
  requireSudo?: boolean;
}

/** Fields shared by every enrollment-verify input (factor-specific ids live in the cfg closure). */
interface EnrollmentCommonInput {
  credential: string;
  loginName: string;
  requestId?: string;
  organization?: string;
  checkAfter?: 'true' | 'false';
}

/**
 * Shared enrollment-verify flow. Resolves the active session + user, parses the
 * credential JSON, runs the cfg's provider verify call, emits the success/failure
 * audit (with the cfg's factor), then either routes into the checkAfter verify
 * screen or derives the next step from the refreshed session.
 */
async function verifyEnrollment(
  provider: AuthProvider,
  sessions: SessionEntry[],
  cfg: EnrollmentConfig,
  { credential, loginName, requestId, organization, checkAfter }: EnrollmentCommonInput
): Promise<EnrollResult> {
  const resolved = await resolveSessionUser(provider, sessions, loginName, organization);
  if (!resolved) return { ok: false, error: 'SESSION_EXPIRED' };

  const { entry, userId, session: sudoSession } = resolved;

  let parsedCredential: unknown;
  try {
    parsedCredential = JSON.parse(credential) as unknown;
  } catch {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  // Sudo gate — the active session must carry an authentication factor verified within the sudo
  // window. Runs before the provider verify so a hijacked or unattended stale session can never
  // plant a persistent credential. The session is the one resolveSessionUser already read (it had
  // to, to bind userId), so the gate costs no second round-trip; a stale/revoked token never
  // reaches here at all — it resolves to null above and returns SESSION_EXPIRED.
  if (cfg.requireSudo && !isSudoFresh(sudoSession.factors, Date.now())) {
    logAuthEvent('mfa_enroll', 'failure', {
      userId,
      factor: cfg.factor,
      reason: 'sudo_required',
    });
    return { ok: false, error: 'SUDO_REQUIRED' };
  }

  try {
    await cfg.verify(provider, userId, parsedCredential);
  } catch (err) {
    logAuthEvent('mfa_enroll', 'failure', { userId, factor: cfg.factor });
    if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
      return { ok: false, error: 'INVALID_CREDENTIALS' };
    }
    throw err;
  }

  logAuthEvent('mfa_enroll', 'success', { userId, factor: cfg.factor });

  // checkAfter=true: immediately route into the matching verify screen.
  if (checkAfter === 'true') {
    return {
      ok: true,
      target: `${cfg.checkAfterPath}?${threadParams(loginName, requestId, organization)}`,
    };
  }

  // Normal post-enrollment routing: derive next step from current session state.
  const session = await provider.getSession(entry.id, entry.token);
  if (!session) return { ok: false, error: 'SESSION_EXPIRED' };

  // Org-first: an explicit org wins, else the default org (old app's `organization ?? getDefaultOrg()`).
  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(userId),
    provider.getLoginSettings(await resolveOrg(provider, organization)),
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

export async function verifyPasskeyEnrollment(
  provider: AuthProvider,
  sessions: SessionEntry[],
  {
    credential,
    passkeyId,
    loginName,
    requestId,
    organization,
    checkAfter,
    passkeyName,
  }: PasskeyEnrollInput
): Promise<EnrollResult> {
  return verifyEnrollment(
    provider,
    sessions,
    {
      factor: 'passkey',
      // Thread the label; the Zitadel adapter's 'Passkey' fallback
      // still covers an empty submission.
      verify: (p, userId, cred) => p.verifyPasskey(userId, passkeyId, cred, passkeyName),
      checkAfterPath: '/login/passkey',
      requireSudo: true, // Passkey add is sudo-gated; U2F unchanged
    },
    { credential, loginName, requestId, organization, checkAfter }
  );
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
  return verifyEnrollment(
    provider,
    sessions,
    {
      factor: 'u2f',
      // Zitadel verifyU2F reads { u2fId, publicKeyCredential, tokenName } off the cred object.
      verify: (p, userId, cred) =>
        p.verifyU2F(userId, { u2fId, publicKeyCredential: cred, tokenName: '' }),
      checkAfterPath: '/login/security-key',
    },
    { credential, loginName, requestId, organization, checkAfter }
  );
}
