// app/routes/signup.test.ts
// @vitest-environment node
//
// Must run in node env: happy-dom forbids setting the `Cookie` header on a Request.
import { action } from './signup';
import { FakeAuthProvider } from '@/providers/fake/fake-provider';
import { getAuthProvider } from '@/providers/select.server';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi, afterEach } from 'vitest';

const ACTION_URL = 'http://localhost/id/signup';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Mint a valid CSRF token+cookie pair for the signup route URL. */
async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(ACTION_URL));
  return { token, cookie: cookie! };
}

/**
 * POST the signup action with IdP register-and-link fields.
 * Returns the raw action result.
 */
async function runSignupIdpAction(overrides: Record<string, string> = {}): Promise<unknown> {
  const { token, cookie } = await mintCsrf();
  const csrfCookieValue = cookie.split(';')[0];

  const fields: Record<string, string> = {
    csrf: token,
    email: 'alice@acme.test',
    firstName: 'Alice',
    lastName: 'Acme',
    idpIntentId: 'intent1',
    idpIntentToken: 'tok1',
    idpId: 'idp1',
    idpUserId: 'idpUser1',
    idpUserName: 'alice_idp',
    ...overrides,
  };

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    body.set(k, v);
  }

  const req = new Request(ACTION_URL, {
    method: 'POST',
    headers: {
      cookie: csrfCookieValue,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  return action({ request: req, params: {}, context: {} as never } as never);
}

describe('signup register-and-link path (CODE-MIN-04)', () => {
  it('register-and-link calls addIdpLink once and does not pass idpLink to register (CODE-MIN-04)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;

    const registerCalls: unknown[] = [];
    const addIdpLinkCalls: unknown[] = [];

    vi.spyOn(fake, 'register').mockImplementation(async (input) => {
      registerCalls.push(input);
      return { id: 'u1', loginName: 'alice@acme.test' };
    });
    vi.spyOn(fake, 'addIdpLink').mockImplementation(async (...args) => {
      addIdpLinkCalls.push(args);
    });
    vi.spyOn(fake, 'createSession').mockResolvedValue({
      id: 'sess1',
      token: 'sess-tok',
      changedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    } as never);

    await runSignupIdpAction();

    expect(registerCalls[0]).not.toHaveProperty('idpLink');
    expect(addIdpLinkCalls).toHaveLength(1);
  });
});
