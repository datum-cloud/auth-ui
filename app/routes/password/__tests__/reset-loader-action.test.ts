// @vitest-environment node
//
// Loader and action unit tests for password/reset — branches NOT covered by the
// existing reset-delivery-guard.test.ts (which stubs AUTH_EMAIL_DELIVERY_ENABLED=false).
// This file tests the ENABLED path: loader returns data, action success renders
// genericCheckYourEmail, and the `sent` branch check in the action.
//
// node env: no DOM needed; loaders/actions called directly.
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// ─── env stub — delivery ENABLED (default for these tests) ───────────────────
vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, AUTH_EMAIL_DELIVERY_ENABLED: true, MAXMIND_ACCOUNT_ID: '' },
  };
});

// trustedAppOrigin just needs to return a string
vi.mock('@/server/infra/app-origin.server', () => ({
  trustedAppOrigin: () => 'http://localhost',
}));

let fakeProvider: Record<string, unknown>;
vi.mock('@/server/auth-context.server', () => ({
  providerForRequest: () => fakeProvider,
}));

// Stub the password service so tests don't need a live provider
vi.mock('@/resources/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/resources/password')>();
  return { ...actual, requestPasswordReset: async () => undefined };
});

const { loader, action } = await import('@/routes/password/reset');

const ORIGIN = 'http://localhost';

async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}/password/reset`));
  return { token, cookie: cookie! };
}

function getRequest(search = '') {
  return new Request(`${ORIGIN}/password/reset${search}`);
}

function postRequest(fields: Record<string, string>, cookieHeader: string): Request {
  const cookieValue = cookieHeader.split(';')[0];
  return new Request(`${ORIGIN}/password/reset`, {
    method: 'POST',
    headers: { cookie: cookieValue, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

function routeArgs(request: Request) {
  return { request, params: {}, context: {} as never } as never;
}

function statusOf(res: unknown): number {
  if (res instanceof Response) return res.status;
  return (res as { init?: { status?: number } }).init?.status ?? 200;
}

async function bodyOf(res: unknown): Promise<Record<string, unknown> | null> {
  if (res instanceof Response) {
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return (res as { data?: Record<string, unknown> }).data ?? null;
}

// ─── Loader — delivery ENABLED ────────────────────────────────────────────────

describe('password/reset loader — delivery enabled', () => {
  beforeEach(() => {
    fakeProvider = {
      getBranding: async () => ({ logoUrl: undefined, primaryColor: undefined }),
    };
  });

  it('returns csrfToken and optional org/requestId from query', async () => {
    const res = await loader(routeArgs(getRequest('?organization=org1&requestId=rq1')));
    const body = await bodyOf(res);
    expect(typeof body?.csrfToken).toBe('string');
    expect(body?.organization).toBe('org1');
    expect(body?.requestId).toBe('rq1');
  });

  it('returns undefined for optional params when absent', async () => {
    const res = await loader(routeArgs(getRequest()));
    const body = await bodyOf(res);
    expect(body?.organization).toBeUndefined();
    expect(body?.requestId).toBeUndefined();
  });
});

// ─── Action — delivery ENABLED ────────────────────────────────────────────────

describe('password/reset action — delivery enabled', () => {
  beforeEach(() => {
    fakeProvider = {};
  });

  it('returns 400 INVALID_INPUT when loginName is missing', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token }, cookie);
    const res = await action(routeArgs(req));
    expect(statusOf(res)).toBe(400);
    const body = await bodyOf(res);
    expect(body?.error).toBe('INVALID_INPUT');
  });

  it('returns the sent confirmation shape when loginName is provided', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, loginName: 'user@example.com' }, cookie);
    const res = await action(routeArgs(req));
    // genericCheckYourEmail returns {sent:true, email:loginName}
    const body = await bodyOf(res);
    expect(body).toHaveProperty('email', 'user@example.com');
  });
});
