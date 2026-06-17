// Route-level security regression: external-IdP return URLs must use PUBLIC_ORIGIN,
// not the request Host. The IdP-start URL BUILDING is unit-tested at the service level in
// app/resources/login/__tests__/idp-origin.test.ts (it asserts the service uses the trusted
// `origin` it is handed). THIS test is the irreplaceable route-level guard: it proves the
// route derives that origin from trustedAppOrigin(request) — i.e. PUBLIC_ORIGIN — and NEVER
// from the request Host, by driving the real route action with a SPOOFED origin.
//
// Under the single-origin proxy (browser at https://auth.localtest.me:30000, auth-ui served
// under /id), the request Host seen by the server is NOT the browser's origin. If the
// success/failure URLs are built from url.origin (the request Host), Zitadel rejects the
// callback because the registered allowed-redirect URI uses the public origin.
//
// Fix: all three IdP-start call sites must call trustedAppOrigin(request) instead of
// url.origin so PUBLIC_ORIGIN is used when set (production/proxy) and the request origin
// is used only as a fallback (dev/test without PUBLIC_ORIGIN).
//
// This file exercises login/index.tsx (action, intent='idp').
// @vitest-environment node
//
// node env: happy-dom enforces Fetch spec rules that forbid setting the Cookie header,
// which breaks the CSRF round-trip used here.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { action } from '@/routes/login/index';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// trustedAppOrigin reads env.PUBLIC_ORIGIN at call time; pin it to the trusted proxy
// origin so the assertion is meaningful (distinct from the spoofed request host).
// vi.mock is hoisted to the top of the file by vitest before any imports resolve.
vi.mock('@/utils/env/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/env/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, PUBLIC_ORIGIN: 'https://auth.localtest.me:30000' },
  };
});

const PUBLIC_ORIGIN = 'https://auth.localtest.me:30000';
const SPOOFED_ORIGIN = 'http://evil.example';
const GOOGLE_IDP_ID = 'idp-g'; // seeded in select.server.ts fake singleton

/** Mint a CSRF token+cookie pair against the login route URL on the SPOOFED origin. */
async function mintCsrfSpoofed() {
  const [token, cookie] = await getCsrfToken(new Request(`${SPOOFED_ORIGIN}/id/login`));
  return { token, cookie: cookie! };
}

/** Build a POST Request for the login action with an IdP intent. */
function idpPostRequest(
  origin: string,
  fields: Record<string, string>,
  cookieHeader: string
): Request {
  const cookieValue = cookieHeader.split(';')[0];
  const body = new URLSearchParams(fields);
  return new Request(`${origin}/id/login`, {
    method: 'POST',
    headers: {
      cookie: cookieValue,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
}

describe('login action — IdP start: return URLs must use PUBLIC_ORIGIN, not request Host', () => {
  it('uses PUBLIC_ORIGIN for success URL when set (proxy/single-origin scenario)', async () => {
    // Arrange: spy on startIdpIntent to capture the urls argument.
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'startIdpIntent');

    // Request comes in with a SPOOFED origin (as it would through the reverse-proxy).
    const { token, cookie } = await mintCsrfSpoofed();
    const req = idpPostRequest(
      SPOOFED_ORIGIN,
      { csrf: token, intent: 'idp', idpId: GOOGLE_IDP_ID },
      cookie
    );

    // Act
    await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    } as never);

    // Assert: startIdpIntent must have been called once and the success URL must
    // use PUBLIC_ORIGIN — NOT the spoofed evil.example host.
    expect(spy).toHaveBeenCalledTimes(1);
    const [_idpId, urls] = spy.mock.calls[0];
    const successUrl: string = (urls as { success: string; failure: string }).success;

    expect(successUrl).toContain('/id/sso/');
    expect(successUrl.startsWith(`${PUBLIC_ORIGIN}/id/sso/`)).toBe(true);
    expect(successUrl).not.toContain('evil.example');
  });
});
