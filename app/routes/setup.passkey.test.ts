// app/routes/setup.passkey.test.ts
// @vitest-environment node
//
// Must run in node env: happy-dom forbids setting the `Cookie` header on a Request.
import { loader } from './setup.passkey';
import { FakeAuthProvider } from '@/providers/fake/fake-provider';
import { getAuthProvider } from '@/providers/select.server';
import { ProviderError } from '@/providers/types';
import { hashActor, logAuthEvent } from '@/server/observability';
import { sessionsCookie } from '@/session/cookie';
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock observability so tests can intercept logAuthEvent calls.
vi.mock('@/server/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/observability')>();
  return { ...actual, logAuthEvent: vi.fn() };
});

const LOADER_URL = 'http://localhost/id/setup/passkey';

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(logAuthEvent).mockClear();
});

/** Serialize a sessions cookie with a single valid entry for the given loginName. */
async function mintSessionsCookie(loginName = 'alice@acme.test', organization?: string) {
  const entry = {
    id: 's1',
    token: 't1',
    loginName,
    organization,
    creationTs: '2026-01-01T00:00:00.000Z',
    expirationTs: '2099-01-01T00:00:00.000Z',
    changeTs: '2026-01-01T00:00:00.000Z',
  };
  return sessionsCookie.serialize([entry]);
}

/**
 * Run the setup.passkey loader with the given loginName and optional overrides.
 * Ensures we have a valid session cookie so the session guard passes.
 */
async function runSetupPasskeyLoader(loginName = 'alice@acme.test') {
  const sessionsCookieHeader = await mintSessionsCookie(loginName);
  const sessionsCookieValue = sessionsCookieHeader.split(';')[0];

  const req = new Request(`${LOADER_URL}?loginName=${encodeURIComponent(loginName)}`, {
    headers: { cookie: sessionsCookieValue },
  });

  return loader({ request: req, params: {}, context: {} as never } as never);
}

// ---------------------------------------------------------------------------
// Task 9 — CODE-MIN-29: log challenge error reason + hash actor
// ---------------------------------------------------------------------------

describe('setup.passkey loader — challenge failure audit (CODE-MIN-29)', () => {
  it('logs a reason and a hashed actor when the challenge fails (CODE-MIN-29)', async () => {
    // Arrange: fake provider's passkeyRegisterLink rejects.
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'passkeyRegisterLink').mockRejectedValue(new Error('zitadel down'));

    // Act: loader should NOT throw — it degrades gracefully with publicKey=null.
    await runSetupPasskeyLoader('alice@acme.test');

    // Assert: a failure audit event must have been emitted.
    const calls = vi.mocked(logAuthEvent).mock.calls;
    const failureCall = calls.find(
      ([event, outcome]) => event === 'mfa_enroll_challenge' && outcome === 'failure'
    );
    expect(failureCall).toBeDefined();

    const fields = failureCall?.[2] as Record<string, unknown> | undefined;

    // a non-ProviderError failure maps to the typed 'UNKNOWN' code (CODE-MIN-29).
    expect(fields?.code).toBe('UNKNOWN');

    // raw loginName must NOT appear in the fields (CCD-9).
    expect(fields?.loginName).toBeUndefined();

    // actor must be a hashed string.
    expect(typeof fields?.actor).toBe('string');
  });

  it('logs the typed ProviderError code and surfaces challengeFailed in the loader return (CODE-MIN-29)', async () => {
    // Arrange: fake provider's passkeyRegisterLink rejects with a typed ProviderError.
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'passkeyRegisterLink').mockRejectedValue(
      new ProviderError('UNAVAILABLE', 'zitadel down')
    );

    // Act: loader degrades gracefully (no throw) and reports the failure to the UI.
    const response = await runSetupPasskeyLoader('alice@acme.test');
    const body = (response as unknown as { data: { challengeFailed: boolean; publicKey: unknown } })
      .data;

    // Assert: a visible enrollment-failure state is surfaced in the loader return.
    expect(body.challengeFailed).toBe(true);
    expect(body.publicKey).toBeNull();

    // Assert: the failure audit carries the TYPED ProviderError code, a hashed actor, and the factor.
    const failureCall = vi
      .mocked(logAuthEvent)
      .mock.calls.find(
        ([event, outcome]) => event === 'mfa_enroll_challenge' && outcome === 'failure'
      );
    const fields = failureCall?.[2] as Record<string, unknown> | undefined;
    expect(fields?.code).toBe('UNAVAILABLE');
    expect(fields?.factor).toBe('passkey');
    expect(fields?.actor).toBe(hashActor('alice@acme.test'));
    // raw loginName must NOT appear (CCD-9).
    expect(fields?.loginName).toBeUndefined();
  });

  it("uses 'UNKNOWN' code for a non-ProviderError challenge failure (CODE-MIN-29)", async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'passkeyRegisterLink').mockRejectedValue(new Error('boom'));

    await runSetupPasskeyLoader('alice@acme.test');

    const failureCall = vi
      .mocked(logAuthEvent)
      .mock.calls.find(
        ([event, outcome]) => event === 'mfa_enroll_challenge' && outcome === 'failure'
      );
    const fields = failureCall?.[2] as Record<string, unknown> | undefined;
    expect(fields?.code).toBe('UNKNOWN');
  });
});
