// app/routes/device.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object, which breaks the
// CSRF round-trip (same reasoning as app/server/csrf.test.ts).
import { action } from './device';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect } from 'vitest';

/** Mint a valid CSRF token+cookie pair against the device route URL. */
async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request('http://localhost/id/device'));
  // getCsrfToken always emits a Set-Cookie on a cookie-less request.
  return { token, cookie: cookie! };
}

/** Build a POST Request for the /device action with CSRF headers + body. */
function postRequest(fields: Record<string, string>, cookieHeader: string): Request {
  // Strip Set-Cookie attributes; keep only the name=value pair.
  const cookieValue = cookieHeader.split(';')[0];
  const body = new URLSearchParams(fields);
  return new Request('http://localhost/id/device', {
    method: 'POST',
    headers: {
      cookie: cookieValue,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
}

describe('/device action', () => {
  it('valid user code → 302 redirect to /device/authorize with requestId and user_code', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, userCode: 'WDJB-MJHT' }, cookie);

    const res = await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    // redirect() returns a real Response — cast to access status/headers
    const redirect = res as Response;
    expect(redirect.status).toBe(302);
    const location = redirect.headers.get('location') ?? '';
    expect(location).toContain('/device/authorize');
    // requestId carries the STABLE user code, not the device-auth id: the real
    // Zitadel adapter returns a different opaque id per getDeviceAuth call, so the
    // user code is the only handle the ceremony can re-resolve after login.
    expect(location).toContain('requestId=device_WDJB-MJHT');
    expect(location).toContain('user_code=WDJB-MJHT');
  });

  it('unknown user code → not a redirect; data error is not_found with status 404', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, userCode: 'NOPE' }, cookie);

    // data() returns DataWithResponseInit — not a Response — so it won't have .status directly.
    // The redirect case (valid code) returns a real Response with .status 302.
    // We verify: (a) it's NOT a redirect (status !== 302), (b) the init status is 404,
    // and (c) the payload error field is 'not_found'.
    const res = await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    // Must NOT be a redirect
    expect(res instanceof Response && (res as Response).status === 302).toBe(false);
    // data() object: { type: 'DataWithResponseInit', data: {...}, init: { status: 404 } }
    const asData = res as { data?: { error?: string }; init?: { status?: number } };
    expect(asData.init?.status).toBe(404);
    expect(asData.data?.error).toBe('not_found');
  });
});
