// app/resources/mfa/__tests__/choose-mfa-method.service.test.ts
//
// Pass 2 service tests for the /login/mfa action logic. Ported from
// routes/login/__tests__/mfa.test.ts — instead of posting through the route action with a
// CSRF + sessions cookie, these call chooseMfaMethod directly against the fake provider
// singleton with an in-memory SessionEntry list and plain form entries.
//
// Task 8 — CODE-MIN-28: a findUser failure during the best-effort audit-userId lookup must be
// surfaced (a failure audit line), must NOT abort routing (the success routing event still
// fires), and must NOT leak the raw loginName (CCD-9 — only the hashed actor).
import { chooseMfaMethod } from '@/resources/mfa';
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import type { SessionEntry } from '@/modules/auth/session/cookie';
import { logAuthEvent } from '@/server/observability';
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock observability so tests can intercept logAuthEvent calls.
vi.mock('@/server/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/observability')>();
  return { ...actual, logAuthEvent: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(logAuthEvent).mockClear();
});

function fakeProvider(): FakeAuthProvider {
  return getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
}

/** A single valid session entry for the given loginName (mirrors the cookie the route reads). */
function sessions(loginName: string, organization?: string): SessionEntry[] {
  return [
    {
      id: 's1',
      token: 't1',
      loginName,
      organization,
      creationTs: '2026-01-01T00:00:00.000Z',
      expirationTs: '2099-01-01T00:00:00.000Z',
      changeTs: '2026-01-01T00:00:00.000Z',
    },
  ];
}

/** Drive chooseMfaMethod with the totp method (matching the original route POST body). */
async function runChoose(
  provider: FakeAuthProvider,
  loginName = 'alice@acme.test',
  organization?: string,
  method = 'totp'
) {
  return chooseMfaMethod(provider, sessions(loginName, organization), { loginName, method }, {
    loginName,
    organization,
  });
}

describe('chooseMfaMethod — findUser failure audit (CODE-MIN-28)', () => {
  it('emits an mfa_method_chosen failure audit line when findUser throws', async () => {
    // Arrange: make the fake provider's findUser reject.
    const fake = fakeProvider();
    vi.spyOn(fake, 'findUser').mockRejectedValue(new Error('boom'));

    // Act
    await runChoose(fake);

    // Assert: a failure event must have been logged for the findUser error.
    const calls = vi.mocked(logAuthEvent).mock.calls;
    const failureCall = calls.find(
      ([event, outcome]) => event === 'mfa_method_chosen' && outcome === 'failure'
    );
    expect(failureCall).toBeDefined();
  });

  it('still emits the success routing event even when findUser throws (routing continues)', async () => {
    const fake = fakeProvider();
    vi.spyOn(fake, 'findUser').mockRejectedValue(new Error('boom'));

    await runChoose(fake);

    const calls = vi.mocked(logAuthEvent).mock.calls;
    const successCall = calls.find(
      ([event, outcome]) => event === 'mfa_method_chosen' && outcome === 'success'
    );
    expect(successCall).toBeDefined();
  });

  it('does NOT put raw loginName in the failure audit fields (CCD-9)', async () => {
    const fake = fakeProvider();
    vi.spyOn(fake, 'findUser').mockRejectedValue(new Error('boom'));

    await runChoose(fake);

    const calls = vi.mocked(logAuthEvent).mock.calls;
    const failureCall = calls.find(
      ([event, outcome]) => event === 'mfa_method_chosen' && outcome === 'failure'
    );
    // The fields object must not contain a raw loginName key.
    const fields = failureCall?.[2] as Record<string, unknown> | undefined;
    expect(fields?.loginName).toBeUndefined();
    // The actor field must be present (hashed).
    expect(typeof fields?.actor).toBe('string');
  });
});
