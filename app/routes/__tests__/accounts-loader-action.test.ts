// @vitest-environment node
//
// Loader and action unit tests for accounts.tsx.
// Lines 33-51 (loader) and 85 (action) were uncovered.
//
// The accounts action is a thin pass-through:
//   assertCsrf → resolveAccountAction → accountActionOutcomeToResponse
// The loader calls listAccounts then wraps with CSRF.
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return { ...actual, env: { ...actual.env, MAXMIND_ACCOUNT_ID: '' } };
});

let fakeProvider: Record<string, unknown>;
vi.mock('@/server/auth-context.server', () => ({
  providerForRequest: () => fakeProvider,
}));

// Stub session resource so tests stay self-contained
vi.mock('@/resources/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/resources/session')>();
  const { data } = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    listAccounts: async () => [
      {
        sessionId: 's1',
        loginName: 'a@b.test',
        displayName: 'Alice',
        isActive: true,
      },
    ],
    resolveAccountAction: async () => ({ kind: 'switch' as const, target: '/signed-in' }),
    accountActionOutcomeToResponse: (outcome: unknown) => {
      const o = outcome as { kind: string; target?: string };
      if (o.target) {
        return new Response(null, { status: 302, headers: { location: o.target } });
      }
      return data({ error: 'SESSION_EXPIRED' }, { status: 400 });
    },
  };
});

const { loader, action } = await import('@/routes/accounts');

const ORIGIN = 'http://localhost';

function routeArgs(request: Request) {
  return { request, params: {}, context: {} as never } as never;
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

function statusOf(res: unknown): number {
  if (res instanceof Response) return res.status;
  return (res as { init?: { status?: number } }).init?.status ?? 200;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

describe('accounts loader', () => {
  beforeEach(() => {
    fakeProvider = {};
  });

  it('returns accounts list and csrfToken', async () => {
    const req = new Request(`${ORIGIN}/accounts`);
    const res = await loader(routeArgs(req));
    const body = await bodyOf(res);
    expect(typeof body?.csrfToken).toBe('string');
    const accounts = body?.accounts as Array<{ loginName: string }>;
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts[0]?.loginName).toBe('a@b.test');
  });
});

// ─── Action ───────────────────────────────────────────────────────────────────

describe('accounts action', () => {
  beforeEach(() => {
    fakeProvider = {};
  });

  it('delegates to resolveAccountAction and returns the outcome response (switch → 302)', async () => {
    const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}/accounts`));
    const cookieValue = cookie!.split(';')[0];
    const req = new Request(`${ORIGIN}/accounts`, {
      method: 'POST',
      headers: { cookie: cookieValue, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        csrf: token,
        intent: 'switch',
        sessionId: 's1',
      }).toString(),
    });
    const res = await action(routeArgs(req));
    expect(statusOf(res)).toBe(302);
  });

  it('throws on CSRF mismatch (assertCsrf)', async () => {
    const req = new Request(`${ORIGIN}/accounts`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: 'bad', intent: 'switch', sessionId: 's1' }).toString(),
    });
    await expect(action(routeArgs(req))).rejects.toThrow();
  });
});
