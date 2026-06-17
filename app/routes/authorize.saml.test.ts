// app/routes/authorize.saml.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object.
//
// This file tests the SAML branch of /authorize (stateless rebuild):
//   - invalid/expired request → error UX
//   - no session → 302 to /login carrying requestId (bootstrap identifier screen)
//   - session present → 302 to /sso/saml-post?id=<id> (the BFF generates the response)
//
// The branch is now STATELESS: /authorize no longer calls createSamlResponse, resolves the
// binding, or sets a saml_form cookie. It validates the request, gates on a session, then hands
// off to the BFF /sso/saml-post handler. Binding-specific + cookie assertions moved to
// app/server/routes/saml-post.test.ts.
import { loader } from './authorize';
import { sessionsCookie } from '@/session/cookie';
import { describe, it, expect } from 'vitest';

/** Serialize a sessions cookie with a single valid entry. */
async function mintSessionsCookie() {
  const entry = {
    id: 's1',
    token: 't1',
    loginName: 'alice@acme.test',
    creationTs: '2026-01-01T00:00:00.000Z',
    expirationTs: '2099-01-01T00:00:00.000Z',
    changeTs: '2026-01-01T00:00:00.000Z',
  };
  return sessionsCookie.serialize([entry]);
}

/** Build a GET request for /authorize with optional sessions cookie. */
async function getRequest(params: Record<string, string>, sessionCookieHeader?: string) {
  const url = new URL('http://localhost/id/authorize');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (sessionCookieHeader) {
    // Strip Set-Cookie attributes; keep only name=value pair.
    headers['cookie'] = sessionCookieHeader.split(';')[0];
  }
  return new Request(url.toString(), { headers });
}

// Note: fake provider singleton (from select.server.ts) must have samlRequests seeded.
// We add them via the "P6 Task 8" comment block in select.server.ts.

describe('/authorize — SAML branch (stateless hand-off)', () => {
  it('valid request WITH session → 302 to /sso/saml-post?id=<id> (no response generated, no cookie)', async () => {
    const sessionsCookieHeader = await mintSessionsCookie();
    const req = await getRequest({ samlRequest: 'sr-post' }, sessionsCookieHeader);

    const res = await loader({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    expect(res instanceof Response).toBe(true);
    const redirect = res as Response;
    expect(redirect.status).toBe(302);
    const location = redirect.headers.get('location') ?? '';
    // Hand off to the BFF, which generates + delivers the response. Only ?id= is carried;
    // no binding resolution, no ACS URL, no SAMLResponse leaves /authorize.
    expect(location).toContain('/sso/saml-post?');
    expect(location).toContain('id=sr-post');
    expect(location).not.toContain('url=');
    expect(location).not.toContain('SAMLResponse');
    // Stateless: /authorize must NOT set any cookie (no saml_form, no store hand-off).
    expect(redirect.headers.get('set-cookie')).toBeNull();
  });

  it('redirect-binding request id WITH session → still just 302 to /sso/saml-post?id=<id>', async () => {
    // /authorize no longer resolves the binding — both redirect- and post-binding request ids
    // hand off identically; the BFF picks the binding. (Previously this redirected straight to SP.)
    const sessionsCookieHeader = await mintSessionsCookie();
    const req = await getRequest({ samlRequest: 'sr-1' }, sessionsCookieHeader);

    const res = await loader({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    const redirect = res as Response;
    expect(redirect.status).toBe(302);
    const location = redirect.headers.get('location') ?? '';
    expect(location).toContain('/sso/saml-post?');
    expect(location).toContain('id=sr-1');
    // No SAMLResponse in the URL — /authorize doesn't generate it anymore.
    expect(location).not.toContain('SAMLResponse');
  });

  it('WITHOUT session → 302 to /login carrying requestId=saml_sr-1', async () => {
    const req = await getRequest({ samlRequest: 'sr-1' });

    const res = await loader({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    expect(res instanceof Response).toBe(true);
    const redirect = res as Response;
    expect(redirect.status).toBe(302);
    const location = redirect.headers.get('location') ?? '';
    // Bootstrap into the identifier screen (not /accounts, whose empty-state link drops
    // the requestId) so the SP-initiated SAML ceremony can resume and complete.
    expect(location).toContain('/login');
    expect(location).toContain('requestId=saml_sr-1');
  });

  it('invalid/expired request id → 302 to /error (fail fast before bootstrapping)', async () => {
    const sessionsCookieHeader = await mintSessionsCookie();
    // 'nope' is not in the fake provider's samlRequests seed → getAuthRequest throws NOT_FOUND.
    const req = await getRequest({ samlRequest: 'nope' }, sessionsCookieHeader);

    const res = await loader({
      request: req,
      params: {},
      context: {} as never,
      url: new URL(req.url),
      pattern: '',
    });

    const redirect = res as Response;
    expect(redirect.status).toBe(302);
    const location = redirect.headers.get('location') ?? '';
    expect(location).toContain('/error');
    // Must not have handed off to the BFF with an unresolvable request.
    expect(location).not.toContain('/sso/saml-post');
  });
});
