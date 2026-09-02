import { env } from '@/server/infra/env.server';
import { createCookie } from 'react-router';

/**
 * Short-lived RE-AUTHENTICATION intent: records the loginName of the account a user clicked to
 * "re-authenticate" (a "Needs re-authentication" entry on /accounts). It rides through the
 * login / IdP round-trip so the completion point (IdP callback, password step) can verify the
 * identity that actually authenticated MATCHES the one being re-authenticated — and, if not,
 * keep both accounts and bounce to the picker instead of silently continuing the ceremony as the
 * wrong identity. It is ALSO used as a best-effort `login_hint` to pre-select the account at the
 * IdP. Never an auth signal — purely an intent marker.
 *
 * httpOnly (never script-readable), sameSite: lax, scoped to `/id` (mirrors the session cookie),
 * signed with SESSION_SECRET. SHORT maxAge (10 min): a re-auth completes promptly, and a stale
 * marker must not gate a later, unrelated login.
 */
export const reauthIntentCookie = createCookie('reauth-intent', {
  httpOnly: true,
  sameSite: 'lax',
  path: '/id',
  secure: env.NODE_ENV === 'production',
  secrets: [env.SESSION_SECRET],
  maxAge: 60 * 10, // 10 minutes
});

/** Serialize the re-auth intent (the loginName being re-authenticated) to a Set-Cookie string. */
export async function serializeReauthIntent(loginName: string): Promise<string> {
  return reauthIntentCookie.serialize(loginName);
}

/** Read the re-auth intent loginName from a request. Returns null when absent or invalid. */
export async function readReauthIntent(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get('cookie');
  const value = await reauthIntentCookie.parse(cookieHeader);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Clear the re-auth intent cookie (Set-Cookie that expires it immediately). */
export async function clearReauthIntent(): Promise<string> {
  return reauthIntentCookie.serialize('', { maxAge: 0 });
}

/** Result of the shared re-auth identity guard (see {@link checkReauthIntent}). */
export interface ReauthCheck {
  /** The identity being re-authenticated, or null when this is not a re-auth flow. */
  intent: string | null;
  /** True only when a re-auth IS in flight AND the authenticated identity differs from it. */
  mismatch: boolean;
  /**
   * A Set-Cookie that clears the intent marker — present whenever a re-auth resolved (intent set),
   * undefined otherwise. Callers MUST append it on both the match and mismatch paths so a stale
   * marker can never gate a later, unrelated login.
   */
  clearCookie?: string;
}

/**
 * Shared re-auth identity guard for a just-completed authentication, used by every login factor
 * (password, IdP callback, passkey/security-key) so they agree. Compares the authenticated
 * loginName against the re-auth intent CASE-INSENSITIVELY (IdPs / SAML may return a different
 * casing than what was stored — an exact compare would false-mismatch case-insensitive accounts).
 * A non-null intent always yields a clearCookie; on mismatch the caller keeps both accounts and
 * routes to the picker instead of completing the ceremony as the unintended identity.
 *
 * `alsoAccept` lets a caller name the SAME identity under a second label. The intent is recorded
 * from the cookie entry's loginName (see reauthRedirect), and an IdP session minted before the
 * issue #1485 fix recorded the IdP-side handle there rather than the Zitadel loginName — so the
 * IdP path passes its IdP-vouched name as well. This does not widen who may pass the guard: both
 * labels are vouched for by the same completed authentication, so accepting either recognizes one
 * identity under two spellings rather than admitting a second identity.
 *
 * TODO(#1485): `alsoAccept` is TRANSITIONAL and its only caller is idp-session.ts. The cookies it
 * exists for are self-expiring — `sessionsCookie` has a 24h maxAge — so once the #1485 fix has
 * been deployed for longer than that, no cookie carrying an IdP handle can still be presented.
 * Drop the parameter and the argument then; the guard reverts to comparing the canonical loginName
 * alone, which is strictly tighter than both this and the pre-fix behavior.
 */
export async function checkReauthIntent(
  request: Request,
  authedLoginName: string,
  alsoAccept?: string
): Promise<ReauthCheck> {
  const intent = await readReauthIntent(request);
  if (intent === null) return { intent: null, mismatch: false };
  const target = intent.trim().toLowerCase();
  const mismatch = ![authedLoginName, alsoAccept].some(
    (name) => name !== undefined && name.trim() !== '' && name.trim().toLowerCase() === target
  );
  return { intent, mismatch, clearCookie: await clearReauthIntent() };
}
