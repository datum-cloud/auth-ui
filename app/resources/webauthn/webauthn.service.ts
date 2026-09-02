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
import {
  byLoginName,
  addSession,
  sessionEntryFromSession,
  serializeSessions,
  type SessionEntry,
} from '@/modules/auth/session/cookie';
import type { Session, User } from '@/modules/auth/types';
import { ProviderError, isStaleSessionError } from '@/modules/auth/types';
import {
  nextStepFromSession as sharedNextStepFromSession,
  threadParams,
  loginBounceTarget,
} from '@/resources/shared/next-step-params';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { isSudoFresh } from '@/resources/shared/sudo';
import { logAuthEvent, hashActor } from '@/server/observability';
import { getOrCreateFingerprintId, userAgentFromRequest } from '@/server/user-agent';

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

// ── VERIFY (assertion) loader ─────────────────────────────────────────────────

export interface WebAuthnChallengeConfig {
  /** Passed to the FIDO2 challenge; 'required' for passkeys, 'discouraged' for U2F security keys. */
  userVerificationRequirement: 'required' | 'discouraged';
  /** Audit event name for the challenge request failure. */
  challengeAuditEvent: 'mfa_passkey_challenge' | 'mfa_u2f_challenge';
}

export interface WebAuthnChallengeInput {
  loginName: string;
  requestId?: string;
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
  /**
   * Set-Cookie values the caller MUST append. Only populated by the stale-session
   * self-heal below, which supersedes the dead entry with a freshly minted one — the
   * challenge is armed on the new session, so dropping these cookies would leave the
   * browser pointing at the dead entry and the assertion would fail to verify.
   */
  setCookies?: string[];
}

/**
 * Opt-in recovery for a session that is dead PROVIDER-SIDE but still present (and
 * apparently unexpired) in the signed `sessions` cookie — see requestWebAuthnChallenge.
 * Carries the Request because re-minting needs the fingerprint + user-agent.
 */
export interface StaleSessionRecovery {
  request: Request;
}

export type WebAuthnChallengeResult = WebAuthnChallengeRedirect | WebAuthnChallengeData;

/**
 * Request a WebAuthn assertion challenge for an already-read sessions list.
 *
 * Guard: require an active session for this loginName → otherwise bounce to
 * loginBounceTarget(requestId, organization) (i.e. /login, carrying ceremony context when present).
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
  { loginName, requestId, organization, domain }: WebAuthnChallengeInput,
  recovery?: StaleSessionRecovery
): Promise<WebAuthnChallengeResult> {
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return { kind: 'redirect', target: loginBounceTarget(requestId, organization) };

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
  } catch (err) {
    logAuthEvent(cfg.challengeAuditEvent, 'failure', { loginName });
    // A STALE session is not the same failure as an unreachable backend, and conflating them
    // is what produced the staging bug: the cookie entry above passed byLoginName (its
    // expirationTs is cookie-local, so a provider-side termination is invisible to it), the
    // challenge request threw NOT_FOUND/PERMISSION_DENIED, and the null options below reached
    // WebAuthnButton's `!publicKey` guard — which tells the user "The passkey verification
    // failed. Please try again." No verification was attempted and no retry could ever succeed,
    // because every retry re-reads the same dead entry. Re-mint instead (below).
    if (recovery && isStaleSessionError(err)) {
      return recoverStaleChallenge(provider, recovery.request, sessions, {
        loginName,
        requestId,
        organization,
        domain,
      });
    }
    // Any OTHER failure stays non-fatal — a transient backend fault is genuinely retryable,
    // so render the screen and let the button surface the error on click.
  }

  return { kind: 'challenge', publicKeyCredentialRequestOptions };
}

/**
 * Recover from a session that the provider has already terminated: mint a fresh user-bound
 * session and arm the challenge on THAT, so the click that follows opens a real passkey
 * dialog instead of a dead end.
 *
 * Only ever reached from requestWebAuthnChallenge's catch, and only when the caller opted in
 * by passing `recovery` — armUserBoundChallenge calls requestWebAuthnChallenge itself, so
 * unconditional recovery would let a stale error recurse back into it. Omitting the parameter
 * on that internal call makes the cycle structurally impossible rather than merely unlikely
 * (types.ts also warns the stale classifier is "NOT appropriate for a session just created
 * earlier in the SAME request").
 *
 * Not an authentication bypass: reaching here requires an entry in the HMAC-signed `sessions`
 * cookie naming this loginName, so the loginName cannot be forged through the URL param, and
 * the minted session carries no verified factors until the assertion below it succeeds.
 *
 * CONTRACT NOTE: armUserBoundChallenge supersedes EVERY same-loginName entry, while we have
 * only proven the one byLoginName selected is dead. byLoginName returns the most recent, so
 * older duplicates are all but certainly dead too — and the blast radius is bounded either
 * way, since dropping a session reference can only force a re-authentication, never grant one.
 */
async function recoverStaleChallenge(
  provider: AuthProvider,
  request: Request,
  sessions: SessionEntry[],
  { loginName, requestId, organization, domain }: WebAuthnChallengeInput
): Promise<WebAuthnChallengeResult> {
  const bounce: WebAuthnChallengeRedirect = {
    kind: 'redirect',
    target: loginBounceTarget(requestId, organization),
  };

  const user = await provider.findUser(loginName, organization);
  if (!user) return bounce;

  const armed = await armUserBoundChallenge(provider, request, sessions, user, domain);
  // Re-mint failed (no passkey, provider refused the challenge) — resolve away from a verify
  // screen that cannot work rather than rendering it with nothing armed.
  if (!armed) return bounce;

  return {
    kind: 'challenge',
    publicKeyCredentialRequestOptions: armed.publicKeyCredentialRequestOptions,
    setCookies: armed.setCookies,
  };
}

// ── USER-BOUND CHALLENGE ARM (usernameless entry points) ──────────────────────

export interface ArmedUserBoundChallenge {
  loginName: string;
  publicKeyCredentialRequestOptions: unknown;
  /** Set-Cookie values the caller must append: the updated sessions list, plus
   *  the fingerprint cookie when one was newly minted. */
  setCookies: string[];
}

/**
 * Mint a Zitadel session bound to `user`, then request a WebAuthn assertion
 * challenge on it — the sequence Zitadel's "a challenge requires a bound user"
 * constraint forces on every usernameless entry point.
 * Two callers: the /login loader (passkey-hint fast path) and the
 * /login/passkey-discover action (identity-discovery path).
 *
 * CALLER CONTRACT: call only after verifying no LIVE session exists for
 * user.loginName. The same-loginName supersede below is safe precisely because
 * that guard ran — see the comment on the filter. Failure split: a
 * session-creation failure THROWS (each caller owns the response: clear the
 * hint / opaque 400); a challenge-request failure returns null (non-fatal —
 * the ordinary page renders, nothing armed, no cookies to set).
 */
export async function armUserBoundChallenge(
  provider: AuthProvider,
  request: Request,
  sessions: SessionEntry[],
  user: User,
  domain: string
): Promise<ArmedUserBoundChallenge | null> {
  const [fingerprintId, fpCookie] = getOrCreateFingerprintId(request);
  const session = await provider.createSession(
    {},
    { userId: user.id, userAgent: userAgentFromRequest(request, fingerprintId) }
  );
  // Supersede any PRIOR entry for the same loginName before persisting — same motivating
  // bug as resolveIdentifier's known-user supersede (login.service.ts:317): a stale,
  // cookie-resident duplicate can shadow the fresh ceremony entry in byLoginName's
  // mostRecent tie-break, sending the challenge request to a session the provider has
  // never heard of. The SCOPE here is narrower than that precedent, deliberately:
  // resolveIdentifier keys its supersede on (loginName, organization) because it mints
  // one org-tagged entry per call; this function's `user` arrives from an instance-wide,
  // org-unscoped lookup (findUser on a bare hint / getUser on a userHandle) and the mint
  // below never sets `organization` on the new entry, so there is no org value to key a
  // filter by. Scoping this loginName-only rather than by identity tuple is safe because
  // the blast radius is bounded to DEAD data: the caller contract requires a live-session
  // scan across every organization for this loginName before calling, so every
  // same-loginName entry still in `sessions` here — under any organization — is already
  // expired. Clearing them can only ever drop stale cookie residue, never a live session.
  // Cross-org regression coverage: conditional-passkey-loader.cy.ts ("stale
  // cross-organization session entry").
  const priorCleared = sessions.filter((s) => s.loginName !== user.loginName);
  const withCeremony = addSession(
    priorCleared,
    sessionEntryFromSession(session, { loginName: user.loginName })
  );
  const challenge = await requestWebAuthnChallenge(
    provider,
    withCeremony,
    {
      userVerificationRequirement: 'required',
      challengeAuditEvent: 'mfa_passkey_challenge',
    },
    { loginName: user.loginName, domain }
  );
  if (challenge.kind !== 'challenge' || !challenge.publicKeyCredentialRequestOptions) {
    return null;
  }
  const setCookies = [await serializeSessions(withCeremony)];
  if (fpCookie) setCookies.push(fpCookie);
  return {
    loginName: user.loginName,
    publicKeyCredentialRequestOptions: challenge.publicKeyCredentialRequestOptions,
    setCookies,
  };
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
 *
 * A findUser MISS is not proof the account is gone (issue #1485). findUser matches an exact
 * loginName or an exact email, while the cookie's loginName is only as good as whatever minted
 * it — IdP sessions created before the idp-session fix stored the IdP-side handle ('octocat'),
 * which matches neither. Those cookies stay valid for up to 12h, so fall back to the id the live
 * session is already bound to rather than bouncing a perfectly good session to /login. The lookup
 * is lazy: an account whose name resolves normally still costs exactly one RPC.
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
  if (user) return { entry, userId: user.id };

  // The stored token may be stale/revoked provider-side, which getSession throws for rather than
  // returning null — same recovery as passkeys.service.ts's resolveActive: treat it as no session
  // at all (the caller redirects), never an unhandled 500.
  let session: Session | null;
  try {
    session = await provider.getSession(entry.id, entry.token);
  } catch (err) {
    if (!isStaleSessionError(err)) throw err;
    session = null;
  }
  return session?.user?.id ? { entry, userId: session.user.id } : null;
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
  const resolved = await resolveEnrollee(provider, sessions, loginName, organization);
  if (!resolved) return { kind: 'redirect', target: loginBounceTarget(requestId, organization) };

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
  const resolved = await resolveEnrollee(provider, sessions, loginName, organization);
  if (!resolved) return { kind: 'redirect', target: loginBounceTarget(requestId, organization) };

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
  const resolved = await resolveEnrollee(provider, sessions, loginName, organization);
  if (!resolved) return { ok: false, error: 'SESSION_EXPIRED' };

  const { entry, userId } = resolved;

  let parsedCredential: unknown;
  try {
    parsedCredential = JSON.parse(credential) as unknown;
  } catch {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  // Sudo gate — the active session must carry an authentication factor
  // verified within the sudo window. Runs before the provider verify so a hijacked or
  // unattended stale session can never plant a persistent credential.
  if (cfg.requireSudo) {
    // A stored session token can be stale/revoked (e.g. created in a different browser)
    // by the time this route sees it — getSession throws a non-transient ProviderError
    // in that case rather than returning null. Same recovery as passkeys.service.ts's
    // resolveActive: treat it as no session at all, not an unhandled 500.
    let sudoSession: Session | null;
    try {
      sudoSession = await provider.getSession(entry.id, entry.token);
    } catch (err) {
      if (isStaleSessionError(err)) {
        logAuthEvent('mfa_enroll', 'failure', {
          userId,
          factor: cfg.factor,
          reason: 'session_expired',
        });
        return { ok: false, error: 'SESSION_EXPIRED' };
      }
      throw err;
    }
    if (!sudoSession || !isSudoFresh(sudoSession.factors, Date.now())) {
      logAuthEvent('mfa_enroll', 'failure', {
        userId,
        factor: cfg.factor,
        reason: 'sudo_required',
      });
      return { ok: false, error: 'SUDO_REQUIRED' };
    }
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
