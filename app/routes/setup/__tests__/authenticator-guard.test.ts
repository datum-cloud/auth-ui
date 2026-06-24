// @vitest-environment node
//
// Broken-session guard on the /setup/authenticator loader. When there is no active
// session for the loginName, the loader redirects to /login. This file pins the OIDC
// ceremony-preservation contract: a mid-OIDC user (requestId in the URL) is redirected
// back to /login WITH requestId+organization, so they return to the relying party
// instead of dead-ending at the default post-login redirect. A non-OIDC request (no
// requestId) keeps the bare /login.
//
// Node environment: the loader reads/writes cookies (CSRF + session), which happy-dom
// forbids on the Cookie header.
import { loader as authenticatorLoader } from '@/routes/setup/authenticator';
import { describe, it, expect } from 'vitest';

const ORIGIN = 'http://localhost';

function loaderArgs(url: string): Parameters<typeof authenticatorLoader>[0] {
  // No Cookie header → readSessions returns [] → byLoginName is undefined → the
  // no-session guard fires before findUser/registerTotp.
  return { request: new Request(url), params: {}, context: {} as never } as never;
}

describe('/setup/authenticator loader — broken-session guard', () => {
  it('no active session WITHOUT requestId → redirect to bare /login', async () => {
    const url = `${ORIGIN}/id/setup/authenticator?loginName=alice%40acme.test`;
    const res = await authenticatorLoader(loaderArgs(url));

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get('location')).toBe('/login');
  });

  it('no active session WITH requestId → redirect preserves requestId + organization', async () => {
    const url = `${ORIGIN}/id/setup/authenticator?loginName=alice%40acme.test&requestId=rq1&organization=acme`;
    const res = await authenticatorLoader(loaderArgs(url));

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get('location')).toBe(
      '/login?requestId=rq1&organization=acme'
    );
  });

  it('no active session WITH requestId but no organization → redirect preserves requestId alone', async () => {
    const url = `${ORIGIN}/id/setup/authenticator?loginName=alice%40acme.test&requestId=rq1`;
    const res = await authenticatorLoader(loaderArgs(url));

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get('location')).toBe('/login?requestId=rq1');
  });
});
