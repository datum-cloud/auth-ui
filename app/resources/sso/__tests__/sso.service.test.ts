// Pass 2 service tests (migrated from routes/sso/__tests__/{sso,idp-return-org}.test.ts).
// @vitest-environment node
//
// node env: happy-dom enforces the Fetch spec rule that forbids setting the `Cookie`
// header on a Request object, which breaks the CSRF round-trip used by the route. The
// service is driven directly (CSRF is asserted by the route, not the service), but we
// keep node env so the FormData/Request plumbing matches the original harness.
//
// Covers:
//   • CODE-MAJ-07 — start intent: a ProviderError from startIdpIntent returns a handled
//     outcome (redirect, never a 500) and emits a failure audit event via the DI seam.
//   • CODE-MAJ-02 — IdP start: organization must be threaded into idpReturnUrls so the
//     org-scoped login policy survives the IdP round-trip.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { ProviderError } from '@/modules/auth/types';
import { runSsoAction, outcomeToResponse } from '@/resources/sso';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/env/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/env/env.server')>();
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

describe('runSsoAction — provider error handling (CODE-MAJ-07)', () => {
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

describe('runSsoAction — IdP start: organization must be threaded into idpReturnUrls (CODE-MAJ-02)', () => {
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
