// app/resources/login/__tests__/device-thread.test.ts
//
// Pass 2: migrated from routes/login/__tests__/device-thread.test.ts. The original
// drove the route actions (with the CSRF + cookie round-trip) to prove the device-
// grant requestId threads through identifier → password. Here we assert the identical
// threading directly against the extracted service functions, using the fake provider
// exactly as the original did. The CSRF/cookie wiring is route-level and re-asserted
// thinly in routes/login/__tests__/device-thread.test.ts.
//
// Device-grant ceremony threading: /device/authorize sends an unauthenticated user
// to /login?requestId=device_<userCode>. The identifier and password flows must
// accept and thread that requestId. Live bug found against real Zitadel 2026-06-13:
// both schemas allowed only /^oidc_/, so the device ceremony dead-ended with a
// 400 INVALID_INPUT at the very first identifier POST.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { resolveIdentifier, verifyLoginPassword } from '@/resources/login';
import { describe, it, expect } from 'vitest';

const REQUEST_ID = 'device_WDJB-MJHT';

describe('device_ requestId threading through the login ceremony', () => {
  it('identifier flow accepts a device_ requestId and threads it (not rejected)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;

    const result = await resolveIdentifier(fake, [], {
      loginName: 'alice@acme.test',
      requestId: REQUEST_ID,
      emailDeliveryEnabled: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The threaded device_ requestId rides on the redirect params toward the next factor.
    expect(result.params.get('requestId')).toBe(REQUEST_ID);
  });

  it('password flow accepts a device_ requestId and threads it (not rejected)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;

    // 1) identifier step establishes the ceremony session entry (returned as a list).
    const idResult = await resolveIdentifier(fake, [], {
      loginName: 'alice@acme.test',
      requestId: REQUEST_ID,
      emailDeliveryEnabled: true,
    });
    expect(idResult.ok).toBe(true);
    if (!idResult.ok) return;
    expect(idResult.sessions.length).toBeGreaterThan(0);

    // 2) password step must accept the threaded device_ requestId.
    const pwResult = await verifyLoginPassword(fake, idResult.sessions, {
      loginName: 'alice@acme.test',
      password: 'hunter2',
      requestId: REQUEST_ID,
    });
    expect(pwResult.ok).toBe(true);
    if (!pwResult.ok) return;
    // The device_ requestId survives into the post-password redirect target.
    expect(pwResult.target).toContain(`requestId=${REQUEST_ID}`);
    // 755-M8: a device_ requestId must reach /signed-in (where resolveSignedIn auto-completes
    // the grant, mirroring the OLD app), NOT the /authorize finalization carve-out — that
    // bounced `datumctl login` to a second consent screen. oidc_/saml_ still take /authorize.
    expect(pwResult.target).toMatch(/^\/signed-in/);
    expect(pwResult.target).not.toContain('/authorize');
  });

  it('755-M8: an oidc_ requestId STILL takes the /authorize finalization carve-out', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const oidcReq = 'oidc_V2_abc123';
    const idResult = await resolveIdentifier(fake, [], {
      loginName: 'alice@acme.test',
      requestId: oidcReq,
      emailDeliveryEnabled: true,
    });
    expect(idResult.ok).toBe(true);
    if (!idResult.ok) return;
    const pwResult = await verifyLoginPassword(fake, idResult.sessions, {
      loginName: 'alice@acme.test',
      password: 'hunter2',
      requestId: oidcReq,
    });
    expect(pwResult.ok).toBe(true);
    if (!pwResult.ok) return;
    // Non-device requestIds keep the OIDC finalization hop to /authorize.
    expect(pwResult.target).toMatch(/^\/authorize/);
    expect(pwResult.target).toContain(`requestId=${oidcReq}`);
  });
});
