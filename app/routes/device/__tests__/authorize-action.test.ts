// @vitest-environment node
//
// Action unit tests + uncovered loader branch for device/authorize.tsx.
// Covers the loader CSRF section after consent loads and the action delegation.
//
// The loader redirect (302) and stale-code (404) paths are already covered by
// authorize.recovery.loader.test.ts. This file covers:
//   1. The loader happy path (consent data + CSRF set)
//   2. The action (delegates decisionOutcomeToResponse) — success is now a 302 redirect
//      to the terminal /device/complete screen, NOT a data({ done }) payload.
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

// Stub loadDeviceConsent to return a consent payload (happy path for loader coverage)
vi.mock('@/resources/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/resources/device')>();
  const { data, redirect } = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    loadDeviceConsent: async () => ({
      kind: 'consent' as const,
      consent: {
        appName: 'Acme CLI',
        scope: ['read'],
        deviceAuthId: 'dev-1',
        requestId: 'rq-1',
      },
    }),
    resolveDeviceDecision: async () => ({
      kind: 'redirect' as const,
      location: '/device/complete?decision=authorize',
    }),
    decisionOutcomeToResponse: (outcome: unknown) => {
      const o = outcome as { kind: string; location?: string };
      if (o.kind === 'redirect') {
        return redirect(o.location ?? '/device/complete');
      }
      return data({ error: 'FAILED_PRECONDITION' }, { status: 400 });
    },
    deviceConsentErrorToResponse: (err: unknown) => {
      return data({ error: err }, { status: 404 });
    },
  };
});

const { loader, action } = await import('@/routes/device/authorize');

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

// ─── Loader — consent happy path ──────────────────────────────────────────────

describe('device/authorize loader — consent happy path', () => {
  beforeEach(() => {
    fakeProvider = {};
  });

  it('returns consent data including csrfToken when loadDeviceConsent returns consent', async () => {
    const req = new Request(`${ORIGIN}/device/authorize?user_code=WDJB-MJHT`);
    const res = await loader(routeArgs(req));
    const body = await bodyOf(res);
    expect(body?.appName).toBe('Acme CLI');
    expect(Array.isArray(body?.scope)).toBe(true);
    expect(body?.deviceAuthId).toBe('dev-1');
    expect(typeof body?.csrfToken).toBe('string');
  });
});

// ─── Action — done path ───────────────────────────────────────────────────────

describe('device/authorize action', () => {
  beforeEach(() => {
    fakeProvider = {};
  });

  it('302-redirects to the terminal /device/complete when resolveDeviceDecision succeeds', async () => {
    const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}/device/authorize`));
    const cookieValue = cookie!.split(';')[0];
    const req = new Request(`${ORIGIN}/device/authorize`, {
      method: 'POST',
      headers: { cookie: cookieValue, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        csrf: token,
        deviceAuthId: 'dev-1',
        requestId: 'rq-1',
        decision: 'authorize',
      }).toString(),
    });
    const res = await action(routeArgs(req));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get('location')).toBe('/device/complete?decision=authorize');
  });

  it('throws on CSRF mismatch (assertCsrf)', async () => {
    const req = new Request(`${ORIGIN}/device/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        csrf: 'bad-token',
        deviceAuthId: 'dev-1',
        requestId: 'rq-1',
        decision: 'deny',
      }).toString(),
    });
    await expect(action(routeArgs(req))).rejects.toThrow();
  });
});
