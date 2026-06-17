// app/resources/password/__tests__/password.service.test.ts
// @vitest-environment node
//
// Pass 2 service tests for the password domain. These port the behavioral
// assertions from the former route tests (routes/password/__tests__/{reset,new}.ts)
// down to the service boundary, calling requestPasswordReset / submitNewPassword
// directly against the fake provider singleton.
//
// SECURITY REGRESSION (sibling of the /verify Host-header fix): the password-reset
// email link MUST be built from the trusted PUBLIC_ORIGIN, never the client-controllable
// request Host header. The route resolves `origin` via trustedAppOrigin(request) — which
// returns PUBLIC_ORIGIN, NOT the request Host — and hands it to the service. Here we feed
// the service the trusted origin and assert the captured urlTemplate uses it, that the
// spoofed Host string never leaks in, and that the {{.Code}} braces stay raw (Zitadel does
// not decode percent-encoded braces, so URLSearchParams must not be used).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { requestPasswordReset, submitNewPassword } from '@/resources/password/password.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The trusted origin the route would derive from PUBLIC_ORIGIN via trustedAppOrigin().
// Deliberately DISTINCT from the spoofed host so the assertions are meaningful.
const TRUSTED_ORIGIN = 'https://auth.datum.net';
const SPOOFED_HOST = 'attacker.evil';

function fakeProvider(): FakeAuthProvider {
  return getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
}

describe('requestPasswordReset — email-link origin (anti Host-header injection)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the reset link from the trusted origin, NOT a spoofed Host', async () => {
    // Spy on the fake singleton so we capture the urlTemplate the service passes to the
    // provider (the fake otherwise discards it).
    const fake = fakeProvider();
    const spy = vi.spyOn(fake, 'sendPasswordReset').mockResolvedValue();

    await requestPasswordReset(fake, {
      loginName: 'alice@acme.test', // u1 — seeded in the fake singleton
      origin: TRUSTED_ORIGIN,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [userId, urlTemplate] = spy.mock.calls[0];
    expect(userId).toBe('u1');
    // Origin-trusted: uses PUBLIC_ORIGIN, never the spoofed Host.
    expect(urlTemplate.startsWith('https://auth.datum.net/password/new?')).toBe(true);
    expect(urlTemplate).not.toContain(SPOOFED_HOST);
    // Raw braces preserved (NOT percent-encoded) — Zitadel does not decode %7B%7B.
    expect(urlTemplate).toContain('code={{.Code}}');
    expect(urlTemplate).not.toContain('%7B');
  });

  it('threads requestId onto the trusted-origin reset link', async () => {
    const fake = fakeProvider();
    const spy = vi.spyOn(fake, 'sendPasswordReset').mockResolvedValue();

    await requestPasswordReset(fake, {
      loginName: 'alice@acme.test',
      origin: TRUSTED_ORIGIN,
      requestId: 'oidc_42',
    });

    const [, urlTemplate] = spy.mock.calls[0];
    expect(urlTemplate.startsWith('https://auth.datum.net/password/new?')).toBe(true);
    expect(urlTemplate).toContain('&requestId=oidc_42');
  });

  it('does NOT call sendPasswordReset for an unknown account (enumeration-safe)', async () => {
    // The flow must look identical whether or not the account exists; in particular it
    // must not leak via a provider call. (The route renders the generic check-your-email.)
    const fake = fakeProvider();
    const spy = vi.spyOn(fake, 'sendPasswordReset').mockResolvedValue();

    await requestPasswordReset(fake, {
      loginName: 'nobody@example.test',
      origin: TRUSTED_ORIGIN,
    });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('submitNewPassword — requestId validation (CODE-MIN-24)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Valid defaults the form would carry (code/userId via hidden inputs, password+confirm).
  function newPasswordForm(overrides: Record<string, string>): Record<string, unknown> {
    return {
      code: 'validCode123',
      userId: 'u1',
      password: 'ValidPassword1!',
      confirm: 'ValidPassword1!',
      ...overrides,
    };
  }

  it('does not forward a malformed requestId to /authorize (CODE-MIN-24)', async () => {
    const fake = fakeProvider();
    vi.spyOn(fake, 'setPasswordWithCode').mockResolvedValue(undefined as never);

    const result = await submitNewPassword(fake, newPasswordForm({ requestId: 'evil://x' }));

    // malformed requestId rejected at the schema boundary → INVALID_INPUT (the route maps
    // this to a 400), OR success target without the bad value.
    if (result.ok) {
      expect(result.target).not.toContain('evil');
      expect(result.target).not.toContain('requestId');
    } else {
      expect(result.error).toBe('INVALID_INPUT');
    }
  });

  it('forwards a valid oidc_ requestId to /authorize on success', async () => {
    const fake = fakeProvider();
    vi.spyOn(fake, 'setPasswordWithCode').mockResolvedValue(undefined as never);

    const result = await submitNewPassword(fake, newPasswordForm({ requestId: 'oidc_abc123' }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target).toContain('requestId=oidc_abc123');
  });
});
