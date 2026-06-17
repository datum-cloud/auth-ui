// app/server/routes/__tests__/saml-post.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object, which breaks the
// session-cookie round-trip (same reasoning as app/routes/device.test.ts).
import { samlPostHandler, renderSamlPostForm } from '../saml-post';
import type { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import * as samlBindingModule from '@/resources/sso/saml-binding';
import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;

// Mirror the Variables type declared in RequestContextEnv so c.get/set typecheck.
type AppVars = { Variables: { secureHeadersNonce?: string } };

/**
 * Construct a minimal Hono app that mounts samlPostHandler at the BFF path.
 * Optionally injects the CSP nonce the middleware would normally provide.
 */
function makeApp(nonce?: string) {
  const app = new Hono<AppVars>();
  app.use('*', async (c, next) => {
    if (nonce !== undefined) c.set('secureHeadersNonce', nonce);
    await next();
  });
  app.get('/id/sso/saml-post', samlPostHandler);
  return app;
}

/**
 * Serialize a sessions cookie with a single valid entry (far-future expiry so it's "most
 * recent"). The fake provider's createSamlResponse ignores the session token, but the handler
 * requires a session to exist before generating any assertion — so a real signed cookie is the
 * correct way to drive the happy paths.
 */
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

/** Strip Set-Cookie attributes; keep only the name=value pair for the Cookie header. */
function toCookieHeader(setCookie: string): string {
  return setCookie.split(';')[0];
}

/** A live session entry matching the signed cookie minted by mintSessionsCookie(). */
const validSession = {
  id: 's1',
  token: 't1',
  loginName: 'alice@acme.test',
  creationTs: '2026-01-01T00:00:00.000Z',
  expirationTs: '2099-01-01T00:00:00.000Z',
  changeTs: '2026-01-01T00:00:00.000Z',
};

/**
 * Drive samlPostHandler with an injected binding/url combination.
 *
 * Accepts the plan's helper API: `{ binding, boundUrl, session }`.
 * The boundUrl is injected via a one-shot spy on resolveSamlBinding so any URL —
 * including javascript: — can be exercised without seeding the fake adapter.
 * The spy is restored immediately after the request completes.
 */
async function runSamlPost({
  binding,
  boundUrl,
  session: _session,
}: {
  binding: 'redirect' | 'post';
  boundUrl: string;
  session: typeof validSession;
}): Promise<Response> {
  const spyResult =
    binding === 'redirect'
      ? ({ kind: 'redirect', url: boundUrl } as const)
      : ({
          kind: 'post',
          url: boundUrl,
          fields: { RelayState: 'rs', SAMLResponse: 'b64' },
        } as const);
  const spy = vi.spyOn(samlBindingModule, 'resolveSamlBinding').mockReturnValueOnce(spyResult);
  try {
    const app = makeApp('n-1');
    const cookie = await mintSessionsCookie();
    // sr-1 is a seeded redirect-binding SAML request in the fake provider.
    return await app.request('/id/sso/saml-post?id=sr-1', {
      headers: { cookie: toCookieHeader(cookie) },
    });
  } finally {
    spy.mockRestore();
  }
}

// ── Pure renderer tests (unchanged behaviour) ──────────────────────────────────

describe('renderSamlPostForm', () => {
  it('renders an auto-submit form with hidden inputs and a nonced script', () => {
    const html = renderSamlPostForm(
      'https://sp.test/acs',
      { RelayState: 'rs', SAMLResponse: 'b64' },
      'n-1'
    );
    expect(html).toContain('action="https://sp.test/acs"');
    expect(html).toContain('name="RelayState" value="rs"');
    expect(html).toContain('name="SAMLResponse" value="b64"');
    expect(html).toContain('<script nonce="n-1">document.forms[0].submit()</script>');
  });

  it('HTML-attribute-escapes field values and the url (XSS defence)', () => {
    const html = renderSamlPostForm(
      'https://sp.test/acs?x="><script>',
      { RelayState: '"><img src=x>', SAMLResponse: 'b64' },
      'n-1'
    );
    // No raw quote-breaking sequence survives — everything is escaped.
    expect(html).not.toContain('"><script>');
    expect(html).not.toContain('"><img');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x&gt;');
  });
});

// ── Handler tests: driven by the FAKE provider + a real session cookie ─────────
//
// AUTH_PROVIDER=fake (vitest.config.ts) → providerForRequest returns the seeded fake singleton.
// Its samlRequests seed: sr-1 → redirect binding; sr-post → post binding.
//
// CODE-MAJ-09: samlPostHandler now calls provider.getSession() to detect stale sessions
// before generating a SAML assertion. The fake's sessions map must have 's1' seeded for
// happy-path tests; the stale-session test overrides via setSessionResult.

describe('samlPostHandler', () => {
  // Seed the session used by mintSessionsCookie() so getSession('s1','t1') returns alive.
  beforeEach(() => {
    fake.seedLiveSession({ id: 's1', token: 't1' });
  });
  afterEach(() => {
    fake.removeLiveSession('s1');
    fake.clearSessionResult('s1');
  });
  it('missing ?id= query param → 400', async () => {
    const app = makeApp('n-1');
    const res = await app.request('/id/sso/saml-post');
    expect(res.status).toBe(400);
  });

  it('no session → redirect to /id/login?requestId=saml_<id> (no assertion generated)', async () => {
    const app = makeApp('n-1');
    // No cookie header → readSessions returns [] → defensive bootstrap redirect.
    const res = await app.request('/id/sso/saml-post?id=sr-post');
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/id/login');
    expect(location).toContain('requestId=saml_sr-post');
  });

  it('valid session + POST-binding request → 200 auto-submit form with ACS url from the generated response + nonce', async () => {
    const app = makeApp('n-1');
    const cookie = await mintSessionsCookie();
    const res = await app.request('/id/sso/saml-post?id=sr-post', {
      headers: { cookie: toCookieHeader(cookie) },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    // ACS url + fields come from the fake adapter's createSamlResponse('sr-post'), NOT from any
    // query/cookie: { url: 'https://sp.test/acs', relayState: 'rs-sr-post', samlResponse: 'resp-sr-post' }
    expect(body).toContain('action="https://sp.test/acs"');
    expect(body).toContain('name="SAMLResponse" value="resp-sr-post"');
    expect(body).toContain('name="RelayState" value="rs-sr-post"');
    expect(body).toContain('<script nonce="n-1">');
  });

  it('valid session + redirect-binding request → 302 to the SP url', async () => {
    const app = makeApp('n-1');
    const cookie = await mintSessionsCookie();
    const res = await app.request('/id/sso/saml-post?id=sr-1', {
      headers: { cookie: toCookieHeader(cookie) },
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    // Fake provider returns { url: 'https://sp.test/acs?SAMLResponse=resp-sr-1', binding: 'redirect' }
    expect(location).toContain('https://sp.test/acs');
    expect(location).toContain('SAMLResponse=resp-sr-1');
  });

  it('valid session + unresolvable request id → 302 to /id/error (defensive re-validation)', async () => {
    const app = makeApp('n-1');
    const cookie = await mintSessionsCookie();
    const res = await app.request('/id/sso/saml-post?id=does-not-exist', {
      headers: { cookie: toCookieHeader(cookie) },
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/id/error');
  });

  it('missing nonce on the post path → 500 (fail-closed: never emit nonce="undefined")', async () => {
    // makeApp with no nonce argument means c.set is never called for secureHeadersNonce.
    const app = makeApp(undefined);
    const cookie = await mintSessionsCookie();
    const res = await app.request('/id/sso/saml-post?id=sr-post', {
      headers: { cookie: toCookieHeader(cookie) },
    });
    expect(res.status).toBe(500);
  });

  // ── CODE-MAJ-09: protocol-validate redirect-binding URL ────────────────────

  it('rejects a non-http(s) SAML redirect-binding URL', async () => {
    const res = await runSamlPost({
      binding: 'redirect',
      boundUrl: 'javascript:alert(1)',
      session: validSession,
    });
    expect([400, 500]).toContain(res.status);
  });

  // ── CODE-MAJ-09: stale-session self-heal ──────────────────────────────────

  it('dead (stale-cookie) session → redirects to /id/login instead of serving a SAML assertion', async () => {
    // beforeEach seeds 's1' as alive; override here to script it as confirmed dead (null).
    fake.setSessionResult('s1', { mode: 'null' });
    const app = makeApp('n-1');
    const cookie = await mintSessionsCookie();
    const res = await app.request('/id/sso/saml-post?id=sr-post', {
      headers: { cookie: toCookieHeader(cookie) },
    });
    // afterEach will clearSessionResult + removeLiveSession
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/id/login');
  });
});
