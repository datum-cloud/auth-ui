// End-to-end thread test: the fingerprintId minted/ensured in processIdpCallback must
// (a) ride out on the finalizing redirect's Set-Cookie when the browser lacked the
//     cookie (closing the first-session gap), and
// (b) be the SAME id handed to createSession's userAgent — so the very first session
//     in cloud-portal Active Sessions carries a non-null fingerprintID.
// When the cookie is already present it is reused: no new fingerprintId Set-Cookie and
// the session's userAgent carries the EXISTING id.
//
// @vitest-environment node
// node env: happy-dom forbids setting the Cookie request header.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import type { IdpIntentResult } from '@/modules/auth/types';
import { processIdpCallback, outcomeToResponse } from '@/resources/sso';
import { describe, it, expect } from 'vitest';

const REGISTER_INTENT_VERIFIED: IdpIntentResult = {
  userId: null,
  information: { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'you@gmail.com' },
  draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
};

/** All set-cookie header values as a proper array (undici exposes getSetCookie). */
function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

/** The fingerprintId cookie's value, or null if no fingerprintId Set-Cookie was emitted. */
function fingerprintCookieValue(res: Response): string | null {
  for (const c of setCookies(res)) {
    const first = c.split(';')[0];
    if (first.startsWith('fingerprintId=')) {
      return decodeURIComponent(first.slice('fingerprintId='.length));
    }
  }
  return null;
}

async function runAutoCreate(cookieHeader?: string): Promise<{
  res: Response;
  provider: FakeAuthProvider;
}> {
  const provider = new FakeAuthProvider({});
  const headers: Record<string, string> = {};
  if (cookieHeader) headers['cookie'] = cookieHeader;
  const request = new Request(
    'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1',
    { headers }
  );
  const outcome = await processIdpCallback(provider, request, 'google', {
    retrieveIdpIntent: async () => REGISTER_INTENT_VERIFIED,
    onAuthEvent: () => {},
  });
  return { res: outcomeToResponse(outcome) as Response, provider };
}

describe('fingerprintId end-to-end through the SSO auto-create createSession', () => {
  it('cookie ABSENT: mints + Set-Cookie, and the SAME id reaches createSession userAgent', async () => {
    const { res, provider } = await runAutoCreate();

    // The finalizing redirect carries a fingerprintId Set-Cookie...
    const minted = fingerprintCookieValue(res);
    expect(minted).toBeTruthy();
    expect(minted).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // ...with the OLD-app attributes preserved.
    const fpCookie = setCookies(res).find((c) => c.startsWith('fingerprintId='))!;
    expect(fpCookie).toContain('Max-Age=31536000');
    expect(fpCookie).toContain('Path=/');
    expect(fpCookie).toContain('HttpOnly');

    // ...and the created session's userAgent carries that EXACT id (no first-session gap).
    expect(provider.lastCreateSessionOpts?.userAgent?.fingerprintId).toBe(minted);

    // The session cookie is still set alongside it (multiple Set-Cookie headers).
    expect(setCookies(res).some((c) => c.startsWith('sessions='))).toBe(true);
  });

  it('cookie PRESENT: reused — no new fingerprintId Set-Cookie, session carries the existing id', async () => {
    const { res, provider } = await runAutoCreate('fingerprintId=existing-fp-xyz');

    // No fresh fingerprintId Set-Cookie is emitted on reuse.
    expect(fingerprintCookieValue(res)).toBeNull();

    // The created session's userAgent carries the EXISTING cookie value.
    expect(provider.lastCreateSessionOpts?.userAgent?.fingerprintId).toBe('existing-fp-xyz');
  });
});
