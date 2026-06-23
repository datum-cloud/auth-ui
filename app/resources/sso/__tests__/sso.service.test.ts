// Pass 2 service tests (migrated from routes/sso/__tests__/{sso,idp-return-org}.test.ts).
// @vitest-environment node
//
// node env: happy-dom enforces the Fetch spec rule that forbids setting the `Cookie`
// header on a Request object, which breaks the CSRF round-trip used by the route. The
// service is driven directly (CSRF is asserted by the route, not the service), but we
// keep node env so the FormData/Request plumbing matches the original harness.
//
// Covers:
//   • Start intent: a ProviderError from startIdpIntent returns a handled
//     outcome (redirect, never a 500) and emits a failure audit event via the DI seam.
//   • IdP start: organization must be threaded into idpReturnUrls so the
//     org-scoped login policy survives the IdP round-trip.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { ProviderError } from '@/modules/auth/types';
import { runSsoAction, outcomeToResponse } from '@/resources/sso';
import { _envSchema } from '@/server/infra/env.server';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, PUBLIC_ORIGIN: 'https://auth.localtest.me:30000' },
  };
});

const PUBLIC_ORIGIN = 'https://auth.localtest.me:30000';
const SPOOFED_ORIGIN = 'http://evil.example';
const BASE = 'http://localhost/id/sso';

/** Build the FormData + Request the service consumes (CSRF is route-level, omitted here). */
function ssoRequest(
  origin: string,
  fields: Record<string, string>
): { request: Request; form: FormData } {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const request = new Request(`${origin}/id/sso`, { method: 'POST' });
  return { request, form };
}

describe('ALLOW_IDP_UNLINK env parsing', () => {
  // Minimal valid base env: SESSION_SECRET must be ≥32 chars (HMAC-SHA256 key).
  const base = { SESSION_SECRET: 'x'.repeat(32) } as Record<string, string>;
  const parseEnv = (raw: Record<string, string>) => _envSchema.parse(raw);

  it("coerces the exact string 'true' to boolean true", () => {
    expect(parseEnv({ ...base, ALLOW_IDP_UNLINK: 'true' }).ALLOW_IDP_UNLINK).toBe(true);
  });

  it("coerces 'false' to boolean false", () => {
    expect(parseEnv({ ...base, ALLOW_IDP_UNLINK: 'false' }).ALLOW_IDP_UNLINK).toBe(false);
  });

  it("coerces '1' (not the literal 'true') to boolean false", () => {
    expect(parseEnv({ ...base, ALLOW_IDP_UNLINK: '1' }).ALLOW_IDP_UNLINK).toBe(false);
  });

  it('defaults to boolean false when unset (fail-closed)', () => {
    expect(parseEnv({ ...base }).ALLOW_IDP_UNLINK).toBe(false);
  });
});

describe('runSsoAction — provider error handling', () => {
  it('start: provider error returns a handled response and logs failure (no 500)', async () => {
    const provider = getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const events: Array<{ event: string; outcome: string }> = [];
    const { request, form } = ssoRequest(BASE, { intent: 'start', provider: 'google' });

    const outcome = await runSsoAction(provider, request, form, {
      startIdpIntent: () => Promise.reject(new ProviderError('UNAVAILABLE', 'down')),
      onAuthEvent: (e, o) => events.push({ event: e, outcome: o }),
    });
    const res = outcomeToResponse(outcome) as Response;

    expect([302, 502]).toContain(res.status);
    expect(events.some((e) => e.outcome === 'failure')).toBe(true);
  });
});

describe('runSsoAction — start: provider slug is hardened against URL-injection chars', () => {
  it('rejects a slug with disallowed characters (path traversal / encoded payload) with a 400', async () => {
    const provider = getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const { request, form } = ssoRequest(BASE, {
      intent: 'start',
      provider: '../evil/../../callback',
    });

    const outcome = await runSsoAction(provider, request, form);
    const res = outcomeToResponse(outcome) as Response;

    expect(res.status).toBe(400);
  });

  it('rejects a slug exceeding 64 chars', async () => {
    const provider = getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const { request, form } = ssoRequest(BASE, {
      intent: 'start',
      provider: 'a'.repeat(65),
    });

    const outcome = await runSsoAction(provider, request, form);
    const res = outcomeToResponse(outcome) as Response;

    expect(res.status).toBe(400);
  });

  it('accepts a well-formed slug (regression guard for the regex)', async () => {
    const provider = getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const { request, form } = ssoRequest(BASE, { intent: 'start', provider: 'google' });

    const outcome = await runSsoAction(provider, request, form);
    const res = outcomeToResponse(outcome) as Response;

    // A valid slug does NOT short-circuit to the 400 Bad Request path.
    expect(res.status).not.toBe(400);
  });
});

describe('runSsoAction — IdP start: organization must be threaded into idpReturnUrls', () => {
  it('sso start threads organization into the IdP success return URL', async () => {
    // Arrange: spy on startIdpIntent to capture the urls argument.
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'startIdpIntent');

    // Request comes in with a SPOOFED origin (as through a reverse-proxy).
    const { request, form } = ssoRequest(SPOOFED_ORIGIN, {
      intent: 'start',
      provider: 'google',
      organization: 'org-123',
    });

    // Act
    await runSsoAction(fake, request, form);

    // Assert: startIdpIntent must have been called and the success URL must
    // contain the organization param.
    expect(spy).toHaveBeenCalledTimes(1);
    const [_idpId, urls] = spy.mock.calls[0];
    const successUrl: string = (urls as { success: string; failure: string }).success;

    expect(successUrl).toContain(`${PUBLIC_ORIGIN}/id/sso/`);
    expect(successUrl).toContain('organization=org-123');
  });
});
