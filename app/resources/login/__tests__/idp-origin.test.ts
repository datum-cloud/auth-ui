// app/resources/login/__tests__/idp-origin.test.ts
//
// Pass 2 service-level companion. This asserts the EXTRACTED service builds the IdP
// success/failure URLs from the trusted `origin` it is handed (no leakage of any other
// host into the URL). It does NOT — and cannot — prove the route derives that origin from
// trustedAppOrigin(request) rather than the request Host: the service can only use the
// origin it is given. The route-level security regression (spoofed request Host must be
// ignored in favor of PUBLIC_ORIGIN) is guarded by app/routes/login/__tests__/idp-origin.test.ts,
// which drives the real route action with a SPOOFED origin. Keep both.
//
// Regression context: external-IdP return URLs must use PUBLIC_ORIGIN, not the request Host.
// Under the single-origin proxy (browser at https://auth.localtest.me:30000, auth-ui
// served under /id), the request Host seen by the server is NOT the browser's origin.
// If the success/failure URLs are built from url.origin (the request Host), Zitadel
// rejects the callback because the registered allowed-redirect URI uses the public origin.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { startIdpIntent } from '@/resources/login';
import { describe, it, expect, vi } from 'vitest';

const PUBLIC_ORIGIN = 'https://auth.localtest.me:30000';
const GOOGLE_IDP_ID = 'idp-g'; // seeded in select.server.ts fake singleton

describe('login IdP start: return URLs must use PUBLIC_ORIGIN, not request Host', () => {
  it('uses PUBLIC_ORIGIN for the success URL (proxy/single-origin scenario)', async () => {
    // Arrange: spy on startIdpIntent to capture the urls argument. The trusted origin
    // (PUBLIC_ORIGIN) is passed to the service explicitly — the route derives it from
    // trustedAppOrigin(request), never the spoofed request Host.
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'startIdpIntent');

    // Act
    const result = await startIdpIntent(fake, { idpId: GOOGLE_IDP_ID, origin: PUBLIC_ORIGIN });

    // Assert: startIdpIntent must have been called once and the success URL must
    // use PUBLIC_ORIGIN — NOT the spoofed evil.example host.
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const [_idpId, urls] = spy.mock.calls[0];
    const successUrl: string = (urls as { success: string; failure: string }).success;

    expect(successUrl).toContain('/id/sso/');
    expect(successUrl.startsWith(`${PUBLIC_ORIGIN}/id/sso/`)).toBe(true);
    expect(successUrl).not.toContain('evil.example');
  });
});

describe('login IdP start: re-auth login_hint (best-effort IdP pre-selection)', () => {
  it('appends login_hint to the authorize URL when re-authenticating a specific account', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const result = await startIdpIntent(fake, {
      idpId: GOOGLE_IDP_ID,
      origin: PUBLIC_ORIGIN,
      reauthHint: 'alice@acme.test',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.authUrl).toContain('login_hint=alice%40acme.test');
  });

  it('omits login_hint for a normal (non-re-auth) IdP start', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const result = await startIdpIntent(fake, { idpId: GOOGLE_IDP_ID, origin: PUBLIC_ORIGIN });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.authUrl).not.toContain('login_hint');
  });
});
