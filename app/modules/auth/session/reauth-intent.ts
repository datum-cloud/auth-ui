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
