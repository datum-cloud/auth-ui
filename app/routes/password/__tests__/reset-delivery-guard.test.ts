// @vitest-environment node
//
// Defense-in-depth: /password/reset loader must redirect to /login when
// AUTH_EMAIL_DELIVERY_ENABLED is false (password reset requires email delivery).
// The action must also return 400 INVALID_INPUT for crafted POSTs.
//
// node env: happy-dom forbids setting the Cookie header, breaking CSRF round-trips.
import { action, loader } from '@/routes/password/reset';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// ─── env stub — delivery OFF ─────────────────────────────────────────────────
vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, AUTH_EMAIL_DELIVERY_ENABLED: false },
  };
});

const ORIGIN = 'http://localhost';

async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}/password/reset`));
  return { token, cookie: cookie! };
}

function postRequest(fields: Record<string, string>, cookieHeader: string): Request {
  const cookieValue = cookieHeader.split(';')[0];
  return new Request(`${ORIGIN}/password/reset`, {
    method: 'POST',
    headers: { cookie: cookieValue, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

function getRequest(search = '') {
  return new Request(`${ORIGIN}/password/reset${search}`);
}

function routeArgs(request: Request) {
  return { request, params: {}, context: {} as never } as never;
}

function statusOf(res: unknown): number | undefined {
  if (res instanceof Response) return res.status;
  return (res as { init?: { status?: number } }).init?.status;
}

async function bodyOf(res: unknown): Promise<{ error?: string } | null> {
  if (res instanceof Response) {
    try {
      return (await res.json()) as { error?: string };
    } catch {
      return null;
    }
  }
  return (res as { data?: { error?: string } }).data ?? null;
}

// ─── Loader guard ─────────────────────────────────────────────────────────────

describe('password/reset loader — guard when delivery is off', () => {
  it('redirects to /login when AUTH_EMAIL_DELIVERY_ENABLED=false', async () => {
    const res = await loader(routeArgs(getRequest()));

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    const location = (res as Response).headers.get('location');
    expect(location).toBe('/login');
  });
});

// ─── Action guard ─────────────────────────────────────────────────────────────

describe('password/reset action — guard when delivery is off', () => {
  it('returns 400 INVALID_INPUT for a crafted POST when delivery is off', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, loginName: 'victim@example.com' }, cookie);
    const res = await action(routeArgs(req));

    expect(statusOf(res)).toBe(400);
    expect((await bodyOf(res))?.error).toBe('INVALID_INPUT');
  });
});
