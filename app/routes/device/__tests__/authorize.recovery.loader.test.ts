// @vitest-environment node
//
// device/authorize — loader status tests for missing/stale device codes.
//
// Redirect half: a CONTEXTLESS / missing user_code bare GET now 302-redirects
// to /device (paths.device.index()) instead of rendering the 400 recovery page — there is no
// code to recover, so the user is sent back to the code-entry screen. The STALE / tampered
// user_code path is UNCHANGED: it keeps the byte-frozen 404 + tailored recovery card.
// url-resolution.cy.ts stays 46/46: its /id/device/authorize check declares
// okStatuses:[200,302,400] + recoveryAnchor:'h1', so a 302 is accepted and the gate follows
// it to /device's h1.
//
// node environment: providerForRequest reaches server-only modules; the route loader is
// exercised directly with a minimal injected provider stub (same pattern as signup/complete.test).
// loadDeviceConsent only calls provider.getDeviceAuth (and only on the stale path), so a one-method
// stub reproduces both paths without importing a concrete provider into a test — keeping the
// `only-composition-imports-providers` boundary surface to composition.ts.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { ProviderError } from '@/modules/auth/types';
import { loader } from '@/routes/device/authorize';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return { ...actual, env: { ...actual.env, MAXMIND_ACCOUNT_ID: '' } };
});

let fakeProvider: Pick<AuthProvider, 'getDeviceAuth'>;
vi.mock('@/server/auth-context.server', () => ({
  providerForRequest: () => fakeProvider as unknown as AuthProvider,
}));

const ORIGIN = 'http://localhost';

async function runLoader(req: Request) {
  return loader({ request: req, params: {}, context: {} as never } as never);
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

beforeEach(() => {
  // Stale/tampered codes make getDeviceAuth fail → loadDeviceConsent maps to the 404 recovery.
  // The missing-code path returns the 400 recovery before any provider call (stub never invoked).
  fakeProvider = {
    getDeviceAuth: async () => {
      // Mirror the fake/zitadel adapters: an unknown/stale code is a NOT_FOUND ProviderError,
      // which loadDeviceConsent maps to the byte-frozen 404 recovery.
      throw new ProviderError('NOT_FOUND', 'stale/unknown user_code');
    },
  };
});

describe('device/authorize loader — recovery status (byte-frozen)', () => {
  it('bare GET (no user_code) → 302 redirect to /device (contextless redirect)', async () => {
    const res = await runLoader(new Request(`${ORIGIN}/id/device/authorize`));

    // Contextless GET: no code to recover → redirect to the /device code-entry screen.
    // 302 ∈ url-resolution.cy.ts okStatuses for /id/device/authorize; the gate follows to /device h1.
    expect(res).toBeInstanceOf(Response);
    expect(statusOf(res)).toBe(302);
    expect((res as Response).headers.get('location')).toBe('/device');
  });

  it('stale/tampered user_code → 404 carrying the recovery error (existing 404 preserved)', async () => {
    const res = await runLoader(new Request(`${ORIGIN}/id/device/authorize?user_code=NOPE`));

    expect(statusOf(res)).toBe(404);
    const body = await bodyOf(res);
    const err = body?.error as { recovery?: string } | undefined;
    expect(err?.recovery).toBe('device');
  });
});
