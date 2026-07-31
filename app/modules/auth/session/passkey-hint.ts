import { env } from '@/server/infra/env.server';
import { createCookie } from 'react-router';

/**
 * Identity hint for the usernameless-passkey fast path: the loginName of the last
 * successfully authenticated user in this browser. NEVER an auth signal and NEVER
 * rendered — it only lets the /login loader mint a WebAuthn challenge for a known
 * user so the browser can offer their passkey via conditional mediation.
 * Same protection class as the `sessions` cookie (which already stores loginName):
 * httpOnly, sameSite lax, path /id, signed with SESSION_SECRET.
 * 7-day maxAge — outlives the 24h sessions cookie (the fast path exists precisely
 * for returning users whose session has expired) yet a shared browser forgets
 * within a week.
 */
export const passkeyHintCookie = createCookie('passkey-hint', {
  httpOnly: true,
  sameSite: 'lax',
  path: '/id',
  secure: env.NODE_ENV === 'production',
  secrets: [env.SESSION_SECRET],
  maxAge: 60 * 60 * 24 * 7, // 7 days
});

/** Serialize the hint (a loginName) to a Set-Cookie string. Written on every successful login. */
export async function serializePasskeyHint(loginName: string): Promise<string> {
  return passkeyHintCookie.serialize(loginName);
}

/** Read the hinted loginName. Returns null when the cookie is absent, invalid, or empty. */
export async function readPasskeyHint(request: Request): Promise<string | null> {
  const value = await passkeyHintCookie.parse(request.headers.get('cookie'));
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A Set-Cookie that expires the hint immediately (logout / unresolvable hinted user). */
export async function clearPasskeyHint(): Promise<string> {
  return passkeyHintCookie.serialize('', { maxAge: 0 });
}
