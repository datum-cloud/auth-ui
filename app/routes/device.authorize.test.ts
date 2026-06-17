// app/routes/device.authorize.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object, which breaks the
// CSRF round-trip (same reasoning as app/server/csrf.test.ts and device.test.ts).
//
// STATE HAZARD: the fake provider is a process-wide singleton. Each state-mutating
// test uses a DISTINCT seeded deviceAuthId so mutation is per-path isolated:
//   dev-authorize → authorize path (this file only; dev-1 is untouched)
//   dev-deny      → deny path
// Never assert isDeviceAuthorized(id) === false for an id another test may have
// authorized. dev-1 is used READ-ONLY by the loader test (user-code resolution).
import { action, loader } from './device.authorize';
import { FakeAuthProvider } from '@/providers/fake/fake-provider';
import { getAuthProvider } from '@/providers/select.server';
import { getCsrfToken } from '@/server/csrf';
import { sessionsCookie } from '@/session/cookie';
import { describe, it, expect } from 'vitest';

/** Mint a valid CSRF token+cookie pair against the device/authorize route URL. */
async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request('http://localhost/id/device/authorize'));
  return { token, cookie: cookie! };
}

/** Serialize a sessions cookie with a single valid entry. */
async function mintSessionsCookie(loginName = 'alice@acme.test') {
  const entry = {
    id: 's1',
    token: 't1',
    loginName,
    creationTs: '2026-01-01T00:00:00.000Z',
    expirationTs: '2099-01-01T00:00:00.000Z',
    changeTs: '2026-01-01T00:00:00.000Z',
  };
  return sessionsCookie.serialize([entry]);
}

/**
 * Build a POST Request for the /device/authorize action.
 * Combines the CSRF cookie and (optionally) the sessions cookie in one header.
 */
function postRequest(
  fields: Record<string, string>,
  csrfCookieHeader: string,
  sessionsCookieHeader?: string
): Request {
  // Strip Set-Cookie attributes; keep only the name=value pair.
  const csrfCookieValue = csrfCookieHeader.split(';')[0];
  const sessionsCookieValue = sessionsCookieHeader ? sessionsCookieHeader.split(';')[0] : undefined;
  const cookieHeader = sessionsCookieValue
    ? `${csrfCookieValue}; ${sessionsCookieValue}`
    : csrfCookieValue;

  const body = new URLSearchParams(fields);
  return new Request('http://localhost/id/device/authorize', {
    method: 'POST',
    headers: {
      cookie: cookieHeader,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
}

describe('/device/authorize loader', () => {
  it('builds requestId from the STABLE user code (device_<userCode>), not the device-auth id', async () => {
    // The real Zitadel adapter returns a different opaque id per getDeviceAuth call;
    // only the user code can be re-resolved when the login ceremony hands back.
    const req = new Request('http://localhost/id/device/authorize?user_code=WDJB-MJHT');
    const res = await loader({ request: req, params: {}, context: {} as never } as never);
    const asData = res as { data?: { requestId?: string; deviceAuthId?: string } };
    expect(asData.data?.requestId).toBe('device_WDJB-MJHT');
    expect(asData.data?.deviceAuthId).toBe('dev-1');
  });
});

describe('/device/authorize action', () => {
  it('authorize with a session cookie → device is authorized; response is not a redirect', async () => {
    const { token, cookie } = await mintCsrf();
    const sessionsCookieHeader = await mintSessionsCookie();
    const req = postRequest(
      {
        csrf: token,
        decision: 'authorize',
        // CODE-MIN-33: use the dedicated dev-authorize id so this mutating test does not
        // interfere with dev-1 (used by the loader test for read-only resolution assertions).
        deviceAuthId: 'dev-authorize',
        requestId: 'device_dev-authorize',
      },
      cookie,
      sessionsCookieHeader
    );

    const res = await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    // Must NOT be a 302 redirect
    const isRedirect = res instanceof Response && (res as Response).status === 302;
    expect(isRedirect).toBe(false);

    // Response should carry done: 'authorize'
    const asData = res as { data?: { done?: string } };
    expect(asData.data?.done).toBe('authorize');

    // The device should now be marked as authorized in the fake singleton.
    // dev-authorize is dedicated to this test — no other test mutates it.
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    expect(fake.isDeviceAuthorized('dev-authorize')).toBe(true);
  });

  it('a dedicated authorize-only device id isolates state from other tests (CODE-MIN-33)', async () => {
    // The isolation contract: the authorize test uses dev-authorize, NOT dev-1, so dev-1
    // remains unauthorized even after the authorize test mutates the singleton.
    // This test is order-independent: it performs its own authorize action on dev-authorize
    // and then asserts that dev-1 was untouched (proving the per-path isolation).
    const { token, cookie } = await mintCsrf();
    const sessionsCookieHeader = await mintSessionsCookie();
    const req = postRequest(
      {
        csrf: token,
        decision: 'authorize',
        deviceAuthId: 'dev-authorize',
        requestId: 'device_dev-authorize',
      },
      cookie,
      sessionsCookieHeader
    );
    await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    // dev-authorize was authorized by THIS test — proof the path works.
    expect(fake.isDeviceAuthorized('dev-authorize')).toBe(true);
    // dev-1 must be unauthorized — this is the actual isolation assertion:
    // the authorize action on dev-authorize must not bleed into dev-1.
    expect(fake.isDeviceAuthorized('dev-1')).toBe(false);
  });

  it('deny → device stays unauthorized; response is not a redirect', async () => {
    const { token, cookie } = await mintCsrf();
    const sessionsCookieHeader = await mintSessionsCookie();
    const req = postRequest(
      {
        csrf: token,
        decision: 'deny',
        deviceAuthId: 'dev-deny',
        requestId: 'device_dev-deny',
      },
      cookie,
      sessionsCookieHeader
    );

    const res = await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    // Must NOT be a 302 redirect
    const isRedirect = res instanceof Response && (res as Response).status === 302;
    expect(isRedirect).toBe(false);

    // Response should carry done: 'deny'
    const asData = res as { data?: { done?: string } };
    expect(asData.data?.done).toBe('deny');

    // The device should NOT be authorized
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    expect(fake.isDeviceAuthorized('dev-deny')).toBe(false);
  });

  it('authorize WITHOUT a session cookie → 302 redirect to /login with requestId', async () => {
    const { token, cookie } = await mintCsrf();
    // No sessions cookie — unauthenticated user
    const req = postRequest(
      {
        csrf: token,
        decision: 'authorize',
        deviceAuthId: 'dev-1',
        requestId: 'device_WDJB-MJHT',
      },
      cookie
    );

    const res = await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    // Must be a 302 redirect
    const redirect = res as Response;
    expect(redirect.status).toBe(302);
    const location = redirect.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('requestId=device_WDJB-MJHT');
  });
});
