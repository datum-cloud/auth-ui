// app/routes/login.mfa.test.ts
// @vitest-environment node
//
// Must run in node env: happy-dom forbids setting the `Cookie` header on a Request
// (same reason as device.authorize.test.ts and password.new.test.ts).
import { action } from './login.mfa';
import { FakeAuthProvider } from '@/providers/fake/fake-provider';
import { getAuthProvider } from '@/providers/select.server';
import { getCsrfToken } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
import { sessionsCookie } from '@/session/cookie';
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock observability so tests can intercept logAuthEvent calls.
vi.mock('@/server/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/observability')>();
  return { ...actual, logAuthEvent: vi.fn() };
});

const ACTION_URL = 'http://localhost/id/login/mfa';

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(logAuthEvent).mockClear();
});

/** Mint a valid CSRF token+cookie pair for the MFA route URL. */
async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(ACTION_URL));
  return { token, cookie: cookie! };
}

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
 * POST to the login.mfa action.
 * Combines the CSRF cookie and sessions cookie, then posts the given fields.
 */
async function runMfaAction(
  fields: Record<string, string>,
  loginName = 'alice@acme.test',
  organization?: string
): Promise<unknown> {
  const { token, cookie } = await mintCsrf();
  const sessionsCookieHeader = await mintSessionsCookie(loginName, organization);

  const csrfCookieValue = cookie.split(';')[0];
  const sessionsCookieValue = sessionsCookieHeader.split(';')[0];
  const cookieHeader = `${csrfCookieValue}; ${sessionsCookieValue}`;

  const body = new URLSearchParams({
    csrf: token,
    loginName,
    method: 'totp',
    ...fields,
  });

  const req = new Request(ACTION_URL, {
    method: 'POST',
    headers: {
      cookie: cookieHeader,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  return action({ request: req, params: {}, context: {} as never } as never);
}

// ---------------------------------------------------------------------------
// Task 8 — CODE-MIN-28: surface findUser failure in audit log
// ---------------------------------------------------------------------------

describe('login.mfa action — findUser failure audit (CODE-MIN-28)', () => {
  it('emits an mfa_method_chosen failure audit line when findUser throws', async () => {
    // Arrange: make the fake provider's findUser reject.
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'findUser').mockRejectedValue(new Error('boom'));

    // Act
    await runMfaAction({ method: 'totp' });

    // Assert: a failure event must have been logged for the findUser error.
    const calls = vi.mocked(logAuthEvent).mock.calls;
    const failureCall = calls.find(
      ([event, outcome]) => event === 'mfa_method_chosen' && outcome === 'failure'
    );
    expect(failureCall).toBeDefined();
  });

  it('still emits the success routing event even when findUser throws (routing continues)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'findUser').mockRejectedValue(new Error('boom'));

    await runMfaAction({ method: 'totp' });

    const calls = vi.mocked(logAuthEvent).mock.calls;
    const successCall = calls.find(
      ([event, outcome]) => event === 'mfa_method_chosen' && outcome === 'success'
    );
    expect(successCall).toBeDefined();
  });

  it('does NOT put raw loginName in the failure audit fields (CCD-9)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'findUser').mockRejectedValue(new Error('boom'));

    await runMfaAction({ method: 'totp' });

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
