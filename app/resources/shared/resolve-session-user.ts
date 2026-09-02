// app/resources/shared/resolve-session-user.ts
//
// "Which user does this cookie entry belong to?" for POST-LOGIN flows (passkey / security-key
// enrollment, TOTP + email/SMS OTP enrollment, the MFA picker).
//
// These flows all receive a `loginName` from the URL or a posted form, match it to a cookie entry,
// and then need a userId. Resolving that userId by NAME (`findUser(loginName)`) answers the wrong
// question: it reports who currently holds that name, not who this session authenticated as. The
// two coincide almost always — and diverge exactly where it is most dangerous:
//
//   * Zitadel frees a loginName on rename. If user A is renamed and user B then takes A's old
//     name, A's still-live cookie entry (loginName `alice`) matches byLoginName, both sudo gates
//     evaluate A's session, but findUser('alice') resolves to B — so the enrollment binds a
//     credential to B's account. A name lookup can never detect that; the session can.
//   * A cookie minted before the issue #1485 fix stores the IdP-side handle, which findUser
//     resolves to nothing, bouncing a perfectly live session to /login.
//
// The session is the only authoritative answer, so it is the ONLY answer here: no name-lookup
// fallback. A session that resolves no user is not an authenticated session, and a flow that
// plants a persistent credential must refuse rather than guess from a caller-supplied string.
//
// RPC cost is unchanged — this getSession REPLACES the findUser these call sites used to issue.
// `session` is returned so a caller with its own sudo gate reuses it instead of re-reading.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { byLoginName, type SessionEntry } from '@/modules/auth/session/session';
import { isStaleSessionError, type Session } from '@/modules/auth/types';

export interface ResolvedSessionUser {
  /** The cookie entry that matched `loginName` (+ `organization`, when given). */
  entry: SessionEntry;
  /** The provider user id the live session is bound to. */
  userId: string;
  /** The live session backing `entry` — callers with a sudo gate reuse this rather than re-read. */
  session: Session;
}

/**
 * Resolve the cookie entry + the user its live session is bound to, or null when either link is
 * dead (no matching entry, a stale/revoked token, or a session with no bound user). Callers map
 * the null to their own redirect or typed error.
 */
export async function resolveSessionUser(
  provider: AuthProvider,
  sessions: SessionEntry[],
  loginName: string,
  organization?: string
): Promise<ResolvedSessionUser | null> {
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return null;

  // A stored token can be stale/revoked provider-side (e.g. the session was created in a different
  // browser), which getSession THROWS a non-transient ProviderError for rather than returning null
  // — same recovery as passkeys.service.ts's resolveActive: treat it as no session at all, never an
  // unhandled 500. A genuinely transient backend error still propagates.
  let session: Session | null;
  try {
    session = await provider.getSession(entry.id, entry.token);
  } catch (err) {
    if (!isStaleSessionError(err)) throw err;
    session = null;
  }
  if (!session?.user?.id) return null;

  return { entry, userId: session.user.id, session };
}
