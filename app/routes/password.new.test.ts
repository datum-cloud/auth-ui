// app/routes/password.new.test.ts
// @vitest-environment node
//
// Runs in node environment: happy-dom forbids setting the `Cookie` header on a
// Request for CSRF round-trips (same reason as password.reset.test.ts).
import { action } from './password.new';
import { FakeAuthProvider } from '@/providers/fake/fake-provider';
import { getAuthProvider } from '@/providers/select.server';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ACTION_URL = 'http://localhost/id/password/new';

/** Mint a valid CSRF token+cookie pair against the new-password route URL. */
async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(ACTION_URL));
  return { token, cookie: cookie! };
}

/**
 * POST to the password.new action with the given field overrides on top of
 * a set of valid defaults (code, userId, password, confirm).
 */
async function runNewPasswordAction(fieldOverrides: Record<string, string>): Promise<unknown> {
  const { token, cookie } = await mintCsrf();
  const csrfCookieValue = cookie.split(';')[0];

  const fields: Record<string, string> = {
    csrf: token,
    code: 'validCode123',
    userId: 'u1',
    password: 'ValidPassword1!',
    confirm: 'ValidPassword1!',
    ...fieldOverrides,
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

/** react-router redirect() returns a native Response; data() returns { type, data, init }. */
function getStatus(res: unknown): number | undefined {
  if (res instanceof Response) return res.status;
  const asData = res as { init?: { status?: number } };
  return asData.init?.status;
}

function getLocation(res: unknown): string {
  if (res instanceof Response) return res.headers.get('location') ?? '';
  return '';
}

describe('/password/new action — requestId validation (CODE-MIN-24)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not forward a malformed requestId to /authorize (CODE-MIN-24)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'setPasswordWithCode').mockResolvedValue(undefined as never);

    const res = await runNewPasswordAction({ requestId: 'evil://x' });

    // malformed requestId rejected at the boundary → 400, OR redirect without the bad value.
    const status = getStatus(res);
    if (status === 302) {
      const location = getLocation(res);
      expect(location).not.toContain('evil');
      expect(location).not.toContain('requestId');
    } else {
      expect(status).toBe(400);
    }
  });

  it('forwards a valid oidc_ requestId to /authorize on success', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'setPasswordWithCode').mockResolvedValue(undefined as never);

    const res = await runNewPasswordAction({ requestId: 'oidc_abc123' });

    expect(getStatus(res)).toBe(302);
    expect(getLocation(res)).toContain('requestId=oidc_abc123');
  });
});
