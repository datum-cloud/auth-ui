import { env } from '@/utils/env/env.server';
import { createCookie } from 'react-router';

/**
 * UX hint: records the last-used login method (idp:<idpId> | email | passkey).
 * Never an auth signal — purely per-browser preference tracking.
 * httpOnly: true (never accessible to scripts), sameSite: lax, 1-year maxAge.
 * Signed with SESSION_SECRET to prevent tampering.
 */
export const lastUsedLoginCookie = createCookie('last-used-login', {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: env.NODE_ENV === 'production',
  secrets: [env.SESSION_SECRET],
  maxAge: 60 * 60 * 24 * 365, // 1 year
});

/**
 * Serialize a last-used login token to a Set-Cookie string.
 * Token ∈ 'idp:<idpId>' | 'email' | 'passkey'
 */
export async function serializeLastUsedLogin(token: string): Promise<string> {
  return lastUsedLoginCookie.serialize(token);
}

/**
 * Read the last-used login token from a request.
 * Returns null if the cookie is absent or invalid.
 */
export async function readLastUsedLogin(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get('cookie');
  const token = await lastUsedLoginCookie.parse(cookieHeader);
  return token ?? null;
}
