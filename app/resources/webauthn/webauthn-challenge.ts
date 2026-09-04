// app/resources/webauthn/webauthn-challenge.ts
//
// WebAuthn ASSERTION-CHALLENGE arming: request a challenge for an existing session
// (requestWebAuthnChallenge), self-heal a session the provider has already terminated
// (recoverStaleChallenge), and mint a user-bound ceremony for discoverable login
// (armUserBoundChallenge).
//
// Extracted from webauthn.service.ts to keep that file under the 800-line ceiling — the same
// move session-logout.service.ts makes for session.service.ts. Re-exported from
// webauthn.service.ts so the barrel and every existing importer are unchanged.
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
   * Set-Cookie values the caller MUST append.
   *
   * Populated on EVERY armed challenge, not just the stale-session self-heal: updateSession
   * rotates the session token, so the cookie has to carry the post-challenge token or the
   * assertion that follows presents a stale one and cannot verify. The self-heal case (which
   * supersedes a dead entry with a freshly minted session) rides the same channel.
   *
   * Dropping these is not a cosmetic omission — it breaks verification outright.
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

  return { kind: 'challenge', publicKeyCredentialRequestOptions, setCookies };
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
  domain: string,
  /**
   * The ceremony's org. The minted entry is TAGGED with it because the verify hop resolves through
   * byLoginName, whose filter is `!organization || s.organization === organization` — an org-less
   * entry is invisible to an org-scoped verify. Undefined on a bare sign-in.
   */
  organization?: string
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
  // org-unscoped lookup (findUser on a bare hint / getUser on a userHandle), so the org is
  // known only when the CALLER supplies the ceremony's (it is undefined on a bare sign-in) and
  // cannot be relied on to key a filter. Scoping this loginName-only rather than by identity
  // tuple is safe because
  // the blast radius is bounded to DEAD data: the caller contract requires a live-session
  // scan across every organization for this loginName before calling, so every
  // same-loginName entry still in `sessions` here — under any organization — is already
  // expired. Clearing them can only ever drop stale cookie residue, never a live session.
  // Cross-org regression coverage: conditional-passkey-loader.cy.ts ("stale
  // cross-organization session entry").
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
  // Prefer the challenge's own cookies: requestWebAuthnChallenge persists the ROTATED session
  // token (updateSession rotates it), and `withCeremony` still holds the pre-challenge one.
  // Serializing withCeremony here would overwrite the good cookie with the stale token and the
  // assertion would fail to verify — which is exactly the bug this replaced. The fallback keeps
  // the ceremony entry in the cookie for the non-fatal case where the challenge request failed
  // but we still render the screen.
  const setCookies = [...(challenge.setCookies ?? [await serializeSessions(withCeremony)])];
  if (fpCookie) setCookies.push(fpCookie);
  return {
    loginName: user.loginName,
    publicKeyCredentialRequestOptions: challenge.publicKeyCredentialRequestOptions,
    setCookies,
  };
}
