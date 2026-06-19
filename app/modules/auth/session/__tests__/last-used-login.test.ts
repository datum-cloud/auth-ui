import {
  serializeLastUsedLogin,
  lastUsedLoginCookie,
} from '@/modules/auth/session/last-used-login';
import { describe, it, expect } from 'vitest';

/**
 * Extract the raw `name=value` pair from a Set-Cookie header string so it can be
 * passed directly to `lastUsedLoginCookie.parse()` as a Cookie request header.
 * (happy-dom blocks `cookie` as a forbidden header on `new Request()`, so we parse
 * via `lastUsedLoginCookie.parse(cookieHeader)` directly instead of via `readLastUsedLogin`.)
 */
function setCookieToCookieHeader(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0].trim();
}

describe('last-used-login cookie', () => {
  it('round-trips a token through serialize → parse', async () => {
    const token = 'idp:g';
    const setCookieValue = await serializeLastUsedLogin(token);
    const cookieHeader = setCookieToCookieHeader(setCookieValue);
    const parsed = await lastUsedLoginCookie.parse(cookieHeader);
    expect(parsed).toBe(token);
  });

  it('returns null when the cookie is absent', async () => {
    const parsed = await lastUsedLoginCookie.parse(null);
    expect(parsed).toBeNull();
  });

  it('round-trips email token', async () => {
    const token = 'email';
    const setCookieValue = await serializeLastUsedLogin(token);
    const cookieHeader = setCookieToCookieHeader(setCookieValue);
    const parsed = await lastUsedLoginCookie.parse(cookieHeader);
    expect(parsed).toBe(token);
  });

  it('round-trips passkey token', async () => {
    const token = 'passkey';
    const setCookieValue = await serializeLastUsedLogin(token);
    const cookieHeader = setCookieToCookieHeader(setCookieValue);
    const parsed = await lastUsedLoginCookie.parse(cookieHeader);
    expect(parsed).toBe(token);
  });
});
