// app/routes/login.device-thread.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom forbids setting the `Cookie` header
// on a Request, which breaks the CSRF round-trip (same as device.test.ts).
//
// Device-grant ceremony threading: /device/authorize sends an unauthenticated user
// to /login?requestId=device_<userCode>. The identifier and password actions must
// accept and thread that requestId. Live bug found against real Zitadel 2026-06-13:
// both schemas allowed only /^oidc_/, so the device ceremony dead-ended with a
// 400 INVALID_INPUT at the very first identifier POST.
import { action as loginAction } from '@/routes/login/index';
import { action as passwordAction } from '@/routes/login/password';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect } from 'vitest';

const REQUEST_ID = 'device_WDJB-MJHT';

/** Mint a valid CSRF token+cookie pair against the given route URL. */
async function mintCsrf(path: string) {
  const [token, cookie] = await getCsrfToken(new Request(`http://localhost${path}`));
  return { token, cookie: cookie! };
}

/** Build a POST Request with combined cookie header (CSRF + optional extras). */
function postRequest(path: string, fields: Record<string, string>, cookies: string[]): Request {
  // Strip Set-Cookie attributes; keep only the name=value pairs.
  const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { cookie: cookieHeader, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

function args(request: Request) {
  return { request, params: {}, context: {} as never } as never;
}

describe('device_ requestId threading through the login ceremony', () => {
  it('identifier action accepts a device_ requestId and threads it (not 400)', async () => {
    const { token, cookie } = await mintCsrf('/id/login');
    const req = postRequest(
      '/id/login',
      { csrf: token, loginName: 'alice@acme.test', requestId: REQUEST_ID },
      [cookie]
    );

    const res = (await loginAction(args(req))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain(`requestId=${REQUEST_ID}`);
  });

  it('password action accepts a device_ requestId and threads it (not 400)', async () => {
    // 1) identifier step establishes the ceremony session cookie
    const first = await mintCsrf('/id/login');
    const loginReq = postRequest(
      '/id/login',
      { csrf: first.token, loginName: 'alice@acme.test', requestId: REQUEST_ID },
      [first.cookie]
    );
    const loginRes = (await loginAction(args(loginReq))) as Response;
    expect(loginRes.status).toBe(302);
    const sessionsCookie = loginRes.headers.get('set-cookie');
    expect(sessionsCookie).toBeTruthy();

    // 2) password step must accept the threaded device_ requestId
    const second = await mintCsrf('/id/login/password');
    const pwReq = postRequest(
      '/id/login/password',
      {
        csrf: second.token,
        loginName: 'alice@acme.test',
        password: 'hunter2',
        requestId: REQUEST_ID,
      },
      [second.cookie, sessionsCookie!]
    );
    const pwRes = (await passwordAction(args(pwReq))) as Response;
    expect(pwRes.status).toBe(302);
    expect(pwRes.headers.get('location') ?? '').toContain(`requestId=${REQUEST_ID}`);
  });
});
