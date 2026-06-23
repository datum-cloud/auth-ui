// @vitest-environment node
//
// Loader and action unit tests for password/new and password/change.
// These routes had zero loader/action coverage after the inline-FormError migration.
//
// node env: avoids happy-dom overhead and lets us call loaders/actions directly.
// CSRF is minted in the test — the same pattern used by reset-delivery-guard.test.ts.
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Provider stub ────────────────────────────────────────────────────────────
let fakeProvider: Record<string, unknown>;
vi.mock('@/server/auth-context.server', () => ({
  providerForRequest: () => fakeProvider,
}));

// Stub readSessions / mostRecent / byId so change.tsx loader/action don't need a
// real signed cookie in the test environment.
vi.mock('@/modules/auth/session/cookie', () => ({
  readSessions: async () => [],
  mostRecent: () => undefined,
  byId: () => undefined,
}));

vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return { ...actual, env: { ...actual.env, MAXMIND_ACCOUNT_ID: '' } };
});

// ─── Password service stub (mutable result slots) ─────────────────────────────
// The action functions are imported once and close over the mocked module, so we
// must use a top-level vi.mock with mutable result variables rather than vi.doMock.
let newPasswordResult: { ok: boolean; error?: string; target?: string } = {
  ok: false,
  error: 'INVALID_INPUT',
};
let changePasswordResult: { ok: boolean; error?: string; target?: string } = {
  ok: false,
  error: 'INVALID_INPUT',
};

vi.mock('@/resources/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/resources/password')>();
  return {
    ...actual,
    submitNewPassword: async () => newPasswordResult,
    changePassword: async () => changePasswordResult,
  };
});

// ─── Route imports (after mocks) ─────────────────────────────────────────────
const { loader: newLoader, action: newAction } = await import('@/routes/password/new');
const { loader: changeLoader, action: changeAction } = await import('@/routes/password/change');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ORIGIN = 'http://localhost';

async function mintCsrf(url: string) {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}${url}`));
  return { token, cookie: cookie! };
}

function getRequest(path: string, search = '') {
  return new Request(`${ORIGIN}${path}${search}`);
}

function postRequest(path: string, fields: Record<string, string>, cookieHeader: string): Request {
  const cookieValue = cookieHeader.split(';')[0];
  return new Request(`${ORIGIN}${path}`, {
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

// ─── password/new — loader ────────────────────────────────────────────────────

describe('password/new loader', () => {
  it('returns csrfToken, code, userId, organization, and requestId from query params', async () => {
    const req = getRequest('/password/new', '?code=abc&userId=u1&organization=org1&requestId=rq1');
    const res = await newLoader(routeArgs(req));
    const body = await bodyOf(res);
    expect(body).toMatchObject({
      code: 'abc',
      userId: 'u1',
      organization: 'org1',
      requestId: 'rq1',
    });
    expect(typeof body?.csrfToken).toBe('string');
  });

  it('returns empty strings when optional params are absent', async () => {
    const req = getRequest('/password/new');
    const res = await newLoader(routeArgs(req));
    const body = await bodyOf(res);
    expect(body?.code).toBe('');
    expect(body?.userId).toBe('');
    expect(body?.organization).toBeUndefined();
    expect(body?.requestId).toBeUndefined();
  });
});

// ─── password/new — action ────────────────────────────────────────────────────

describe('password/new action', () => {
  beforeEach(() => {
    fakeProvider = {};
    newPasswordResult = { ok: false, error: 'INVALID_INPUT' };
  });

  it('returns 400 with error when submitNewPassword returns a non-ok result', async () => {
    newPasswordResult = { ok: false, error: 'INVALID_INPUT' };
    const { token, cookie } = await mintCsrf('/password/new');
    const req = postRequest(
      '/password/new',
      { csrf: token, password: 'pw', confirm: 'pw', code: 'c', userId: 'u' },
      cookie
    );
    const res = await newAction(routeArgs(req));
    expect(statusOf(res)).toBe(400);
    const body = await bodyOf(res);
    expect(body).toHaveProperty('error', 'INVALID_INPUT');
  });

  it('redirects (302) when submitNewPassword returns ok', async () => {
    newPasswordResult = { ok: true, target: '/signed-in' };
    const { token, cookie } = await mintCsrf('/password/new');
    const req = postRequest(
      '/password/new',
      { csrf: token, password: 'pw', confirm: 'pw', code: 'c', userId: 'u' },
      cookie
    );
    const res = await newAction(routeArgs(req));
    // redirect() from react-router returns a real Response with status 302
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
  });
});

// ─── password/change — loader ─────────────────────────────────────────────────

describe('password/change loader', () => {
  it('returns csrfToken, sessionId, loginName, and requestId', async () => {
    const req = getRequest('/password/change', '?requestId=rq2');
    const res = await changeLoader(routeArgs(req));
    const body = await bodyOf(res);
    // readSessions is mocked to return [] → mostRecent → undefined → empty strings
    expect(body?.sessionId).toBe('');
    expect(body?.loginName).toBe('');
    expect(body?.requestId).toBe('rq2');
    expect(typeof body?.csrfToken).toBe('string');
  });

  it('returns undefined requestId when param is absent', async () => {
    const req = getRequest('/password/change');
    const res = await changeLoader(routeArgs(req));
    const body = await bodyOf(res);
    expect(body?.requestId).toBeUndefined();
  });
});

// ─── password/change — action ─────────────────────────────────────────────────

describe('password/change action', () => {
  beforeEach(() => {
    fakeProvider = {};
    changePasswordResult = { ok: false, error: 'INVALID_INPUT' };
  });

  it('returns 400 with error when changePassword returns a non-ok result', async () => {
    changePasswordResult = { ok: false, error: 'INVALID_INPUT' };
    const { token, cookie } = await mintCsrf('/password/change');
    const req = postRequest(
      '/password/change',
      { csrf: token, sessionId: 's', password: 'pw', confirm: 'pw' },
      cookie
    );
    const res = await changeAction(routeArgs(req));
    expect(statusOf(res)).toBe(400);
    const body = await bodyOf(res);
    expect(body).toHaveProperty('error', 'INVALID_INPUT');
  });

  it('redirects (302) when changePassword returns ok', async () => {
    changePasswordResult = { ok: true, target: '/signed-in' };
    const { token, cookie } = await mintCsrf('/password/change');
    const req = postRequest(
      '/password/change',
      { csrf: token, sessionId: 's', password: 'pw', confirm: 'pw' },
      cookie
    );
    const res = await changeAction(routeArgs(req));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
  });
});
