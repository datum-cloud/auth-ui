// Regression test: organization must be threaded into idpReturnUrls in sso.tsx and
// sso.link.tsx so the org-scoped login policy is preserved on the IdP round-trip.
//
// When an OIDC/OAuth IdP redirects back, Zitadel reads the `organization` query param
// from the callback URL to apply the correct login policy. Without it, the org context
// is silently dropped and users may be subject to the wrong policy.
//
// This file covers: CODE-MAJ-02
// @vitest-environment node
import { action } from './sso';
import { FakeAuthProvider } from '@/providers/fake/fake-provider';
import { getAuthProvider } from '@/providers/select.server';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, PUBLIC_ORIGIN: 'https://auth.localtest.me:30000' },
  };
});

const PUBLIC_ORIGIN = 'https://auth.localtest.me:30000';
const SPOOFED_ORIGIN = 'http://evil.example';
const _GOOGLE_IDP_ID = 'idp-g'; // seeded in select.server.ts fake singleton (unused here — test passes slug 'google')

/** Mint a CSRF token+cookie pair against the sso route URL on the SPOOFED origin. */
async function mintCsrfSpoofed() {
  const [token, cookie] = await getCsrfToken(new Request(`${SPOOFED_ORIGIN}/id/sso`));
  return { token, cookie: cookie! };
}

/** Build a POST Request for the sso action with a start intent. */
function ssoPostRequest(
  origin: string,
  fields: Record<string, string>,
  cookieHeader: string
): Request {
  const cookieValue = cookieHeader.split(';')[0];
  const body = new URLSearchParams(fields);
  return new Request(`${origin}/id/sso`, {
    method: 'POST',
    headers: {
      cookie: cookieValue,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
}

describe('sso action — IdP start: organization must be threaded into idpReturnUrls', () => {
  it('sso start threads organization into the IdP success return URL', async () => {
    // Arrange: spy on startIdpIntent to capture the urls argument.
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'startIdpIntent');

    // Request comes in with a SPOOFED origin (as through a reverse-proxy).
    const { token, cookie } = await mintCsrfSpoofed();
    const req = ssoPostRequest(
      SPOOFED_ORIGIN,
      { csrf: token, intent: 'start', provider: 'google', organization: 'org-123' },
      cookie
    );

    // Act
    await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    } as never);

    // Assert: startIdpIntent must have been called and the success URL must
    // contain the organization param.
    expect(spy).toHaveBeenCalledTimes(1);
    const [_idpId, urls] = spy.mock.calls[0];
    const successUrl: string = (urls as { success: string; failure: string }).success;

    expect(successUrl).toContain(`${PUBLIC_ORIGIN}/id/sso/`);
    expect(successUrl).toContain('organization=org-123');
  });
});
