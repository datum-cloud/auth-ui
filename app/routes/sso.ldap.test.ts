// app/routes/sso.ldap.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object, which breaks the
// CSRF round-trip (same reasoning as device.test.ts).
import { action } from './sso.ldap';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect } from 'vitest';

/** Mint a valid CSRF token+cookie pair against the LDAP route URL. */
async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request('http://localhost/id/sso/ldap'));
  return { token, cookie: cookie! };
}

/** Build a POST Request for the /sso/ldap action with CSRF headers + body. */
function postRequest(fields: Record<string, string>, cookieHeader: string): Request {
  // Strip Set-Cookie attributes; keep only the name=value pair.
  const cookieValue = cookieHeader.split(';')[0];
  const body = new URLSearchParams(fields);
  return new Request('http://localhost/id/sso/ldap', {
    method: 'POST',
    headers: {
      cookie: cookieValue,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
}

describe('/sso/ldap action', () => {
  it('valid creds (bob/pw, idpId idp-ldap) → 302 to /signed-in with sessions cookie', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      { csrf: token, username: 'bob', password: 'pw', idpId: 'idp-ldap' },
      cookie
    );

    const res = await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    const redirect = res as Response;
    expect(redirect.status).toBe(302);
    const location = redirect.headers.get('location') ?? '';
    expect(location).toBe('/signed-in');

    // Verify a sessions cookie is set (cookie is HMAC-signed so we can't assert
    // plaintext content — assert the cookie name is present in the header).
    const setCookie = redirect.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('sessions=');
  });

  it('valid creds WITH requestId → 302 to /authorize?requestId=oidc_x', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      {
        csrf: token,
        username: 'bob',
        password: 'pw',
        idpId: 'idp-ldap',
        requestId: 'oidc_x',
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

    const redirect = res as Response;
    expect(redirect.status).toBe(302);
    const location = redirect.headers.get('location') ?? '';
    expect(location).toBe('/authorize?requestId=oidc_x');
  });

  it('bad creds → 401 with error INVALID_CREDENTIALS, not a redirect', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      { csrf: token, username: 'bob', password: 'wrong', idpId: 'idp-ldap' },
      cookie
    );

    const res = await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    // Must NOT be a redirect
    expect(res instanceof Response && (res as Response).status === 302).toBe(false);
    // data() object: { data: {...}, init: { status: 401 } }
    const asData = res as { data?: { error?: string }; init?: { status?: number } };
    expect(asData.init?.status).toBe(401);
    expect(asData.data?.error).toBe('INVALID_CREDENTIALS');
  });

  it('valid creds but UNLINKED LDAP user (empty userId) → 403 ACCOUNT_NOT_LINKED, not a 500/redirect', async () => {
    // Mirrors real Zitadel: an LDAP credential exchange for an IdP user that is not
    // linked to any Zitadel account succeeds but returns userId='' (the resolved
    // intent is a 'register' draft, not a sign-in). Proceeding to createSession would
    // throw [failed_precondition] User ID missing → uncaught 500. The route must
    // instead surface a graceful, typed error.
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      { csrf: token, username: 'unlinked', password: 'pw', idpId: 'idp-ldap' },
      cookie
    );

    const res = await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    // Must NOT be a redirect (a 302 would mean we wrongly proceeded to sign-in).
    expect(res instanceof Response && (res as Response).status === 302).toBe(false);
    const asData = res as { data?: { error?: string }; init?: { status?: number } };
    expect(asData.init?.status).toBe(403);
    expect(asData.data?.error).toBe('ACCOUNT_NOT_LINKED');
  });

  it('valid CSRF but missing idpId → 400 with error invalid_input, not a redirect', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      { csrf: token, username: 'bob', password: 'pw' /* idpId omitted */ },
      cookie
    );

    const res = await action({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    // Must NOT be a redirect
    expect(res instanceof Response && (res as Response).status === 302).toBe(false);
    const asData = res as { data?: { error?: string }; init?: { status?: number } };
    expect(asData.init?.status).toBe(400);
    expect(asData.data?.error).toBe('invalid_input');
  });
});
