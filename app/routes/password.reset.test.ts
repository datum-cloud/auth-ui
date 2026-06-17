// app/routes/password.reset.test.ts
// @vitest-environment node
//
// Runs in the node environment: happy-dom forbids setting the `Cookie` header on a
// Request, which the CSRF round-trip needs (same reason as device.authorize.test.ts).
//
// SECURITY REGRESSION TEST (sibling of the /verify Host-header fix): the password-reset
// email link MUST be built from the trusted PUBLIC_ORIGIN, never the client-controllable
// request Host header. An attacker who could POST `Host: attacker.evil` and have the
// reset link mailed to a victim at attacker.evil would harvest the real reset code +
// userId. We assert the captured urlTemplate uses PUBLIC_ORIGIN and that the spoofed
// Host never appears — AND that the {{.Code}} braces stay raw (Zitadel does not decode
// percent-encoded braces, so URLSearchParams must not be used).
import { action } from './password.reset';
import { FakeAuthProvider } from '@/providers/fake/fake-provider';
import { getAuthProvider } from '@/providers/select.server';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// trustedAppOrigin reads env.PUBLIC_ORIGIN at call time; pin it to a trusted value that
// is DISTINCT from the spoofed request Host so the assertion is meaningful.
vi.mock('@/utils/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/env.server')>();
  return { ...actual, env: { ...actual.env, PUBLIC_ORIGIN: 'https://auth.datum.net' } };
});

const RESET_URL = 'http://localhost/id/password/reset';

/** Mint a valid CSRF token+cookie pair against the reset route URL. */
async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(RESET_URL));
  return { token, cookie: cookie! };
}

/**
 * POST to the reset action with a SPOOFED Host header. `requestId` is threaded onto the
 * template when supplied (the route carries it through).
 */
function postRequest(
  fields: Record<string, string>,
  csrfCookieHeader: string,
  spoofedHost = 'attacker.evil'
): Request {
  const csrfCookieValue = csrfCookieHeader.split(';')[0];
  const body = new URLSearchParams(fields);
  // Build the URL with the spoofed host so `new URL(request.url).host` would be tainted
  // if the route ever fell back to it.
  return new Request(`https://${spoofedHost}/id/password/reset`, {
    method: 'POST',
    headers: {
      cookie: csrfCookieValue,
      host: spoofedHost,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
}

describe('/password/reset action — email-link origin (anti Host-header injection)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the reset link from PUBLIC_ORIGIN, NOT the spoofed request Host', async () => {
    // Spy on the fake singleton so we capture the urlTemplate the route passes to the
    // provider (the fake otherwise discards it).
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'sendPasswordReset').mockResolvedValue();

    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      { csrf: token, loginName: 'alice@acme.test' }, // u1 — seeded in the fake singleton
      cookie,
      'attacker.evil'
    );

    await action({ request: req, params: {}, context: {} as never } as never);

    expect(spy).toHaveBeenCalledTimes(1);
    const [userId, urlTemplate] = spy.mock.calls[0];
    expect(userId).toBe('u1');
    // Origin-trusted: uses PUBLIC_ORIGIN, never the spoofed Host.
    expect(urlTemplate.startsWith('https://auth.datum.net/password/new?')).toBe(true);
    expect(urlTemplate).not.toContain('attacker.evil');
    // Raw braces preserved (NOT percent-encoded) — Zitadel does not decode %7B%7B.
    expect(urlTemplate).toContain('code={{.Code}}');
    expect(urlTemplate).not.toContain('%7B');
  });

  it('threads requestId onto the trusted-origin reset link', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'sendPasswordReset').mockResolvedValue();

    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      { csrf: token, loginName: 'alice@acme.test', requestId: 'oidc_42' },
      cookie
    );

    await action({ request: req, params: {}, context: {} as never } as never);

    const [, urlTemplate] = spy.mock.calls[0];
    expect(urlTemplate.startsWith('https://auth.datum.net/password/new?')).toBe(true);
    expect(urlTemplate).toContain('&requestId=oidc_42');
  });

  it('does NOT call sendPasswordReset for an unknown account (enumeration-safe)', async () => {
    // The route must look identical whether or not the account exists; in particular it
    // must not leak via a provider call. (The response is the generic check-your-email.)
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'sendPasswordReset').mockResolvedValue();

    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, loginName: 'nobody@example.test' }, cookie);

    await action({ request: req, params: {}, context: {} as never } as never);

    expect(spy).not.toHaveBeenCalled();
  });
});
