// WebAuthn assertion-challenge arming: request a challenge for an existing session, self-heal one
// the provider has already terminated, and mint a user-bound ceremony for discoverable login.
// Re-exported from webauthn.service.ts, so importers go through that barrel.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import {
  byLoginName,
  addSession,
  sessionEntryFromSession,
  serializeSessions,
  type SessionEntry,
} from '@/modules/auth/session/cookie';
import type { User } from '@/modules/auth/types';
import { isStaleSessionError } from '@/modules/auth/types';
import { loginBounceTarget } from '@/resources/shared/next-step-params';
import { logAuthEvent } from '@/server/observability';
import { getOrCreateFingerprintId, userAgentFromRequest } from '@/server/user-agent';

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
   * Set-Cookie values the caller MUST append, on every armed challenge. updateSession rotates the
   * session token, so dropping these leaves the browser on the old one and the assertion that
   * follows cannot verify.
   */
  setCookies?: string[];
}

/**
 * Opt-in recovery for a session dead provider-side but still present (and apparently unexpired)
 * in the signed `sessions` cookie. Carries the Request because re-minting needs fingerprint + UA.
 */
export interface StaleSessionRecovery {
  request: Request;
}

export type WebAuthnChallengeResult = WebAuthnChallengeRedirect | WebAuthnChallengeData;

/**
 * Request a WebAuthn assertion challenge for an already-read sessions list. No session for this
 * loginName bounces to /login. A challenge failure is NOT fatal: it returns null options so the
 * screen still renders and the browser surfaces the error on click.
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
  let setCookies: string[] | undefined;
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

    // Persist the ROTATED token: updateSession rotates it and returns the new one, and arming a
    // challenge is an update like any other. Reading only the challenge options left the browser
    // holding a token the provider had already replaced, so every assertion after was rejected.
    setCookies = [
      await serializeSessions(
        addSession(sessions, {
          ...entry,
          token: session.token,
          changeTs: session.changedAt,
          expirationTs: session.expiresAt,
        })
      ),
    ];
  } catch (err) {
    logAuthEvent(cfg.challengeAuditEvent, 'failure', { loginName });
    // A stale session is not an unreachable backend. expirationTs is cookie-local, so a
    // provider-side termination stays invisible to byLoginName: every retry re-reads the same
    // dead entry and none can ever succeed. Re-mint instead.
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

  return { kind: 'challenge', publicKeyCredentialRequestOptions, setCookies };
}

/**
 * Mint a fresh user-bound session for a provider-terminated one and arm the challenge on that.
 *
 * `recovery` is opt-in because armUserBoundChallenge calls requestWebAuthnChallenge itself —
 * unconditional recovery would let a stale error recurse. Omitting it there makes that cycle
 * impossible rather than unlikely.
 *
 * Not an auth bypass: it requires an entry in the HMAC-signed `sessions` cookie naming this
 * loginName, and the minted session carries no verified factors until the assertion succeeds.
 * Note it supersedes EVERY same-loginName entry though only the byLoginName one is proven dead —
 * bounded, since dropping a session reference can only force re-authentication, never grant one.
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
 * Mint a session bound to `user`, then arm a WebAuthn challenge on it — the sequence Zitadel's
 * "a challenge requires a bound user" constraint forces on usernameless entry points.
 *
 * CALLER CONTRACT: call only after verifying no LIVE session exists for user.loginName; the
 * supersede below depends on it. Session creation THROWS (the caller owns the response); a
 * challenge failure returns null (non-fatal — the ordinary page renders with nothing armed).
 */
export async function armUserBoundChallenge(
  provider: AuthProvider,
  request: Request,
  sessions: SessionEntry[],
  user: User,
  domain: string,
  /**
   * The ceremony's org, tagged onto the minted entry: byLoginName filters on it, so an org-less
   * entry is invisible to an org-scoped verify. Undefined on a bare sign-in.
   */
  organization?: string
): Promise<ArmedUserBoundChallenge | null> {
  const [fingerprintId, fpCookie] = getOrCreateFingerprintId(request);
  const session = await provider.createSession(
    {},
    { userId: user.id, userAgent: userAgentFromRequest(request, fingerprintId) }
  );
  // Supersede any prior same-loginName entry first: a stale cookie-resident duplicate can shadow
  // the fresh ceremony entry in byLoginName's mostRecent tie-break, aiming the challenge at a
  // session the provider never heard of. Keyed on loginName ALONE, not (loginName, organization),
  // because `user` comes from an org-unscoped lookup — safe only because the caller contract
  // guarantees a cross-org live-session scan ran first, so everything cleared here is expired.
  // Cross-org coverage: conditional-passkey-loader.cy.ts.
  const priorCleared = sessions.filter((s) => s.loginName !== user.loginName);
  const withCeremony = addSession(
    priorCleared,
    sessionEntryFromSession(session, { loginName: user.loginName, organization })
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
  // Prefer the challenge's own cookies — they carry the ROTATED token, while `withCeremony` still
  // holds the pre-challenge one, and serializing that would break verification. The fallback only
  // covers the non-fatal case where the challenge failed but the screen still renders.
  const setCookies = [...(challenge.setCookies ?? [await serializeSessions(withCeremony)])];
  if (fpCookie) setCookies.push(fpCookie);
  return {
    loginName: user.loginName,
    publicKeyCredentialRequestOptions: challenge.publicKeyCredentialRequestOptions,
    setCookies,
  };
}
