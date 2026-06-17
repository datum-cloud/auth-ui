// app/resources/session/__tests__/session.service.signed-in.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object.
//
// Pass 2: service-level rewrite of the former routes/__tests__/signed-in.test.ts.
// Every behavioral assertion from that route test is preserved here, asserted directly at
// the service boundary (`resolveSignedIn` → typed SignedInOutcome). The route is now a thin
// wrapper that turns a `redirect` outcome into a redirect() and a `page` outcome into the
// terminal data() payload (CSRF minting stays route-level), so the redirect-location and
// terminal-page-loginName assertions map 1:1 onto the outcome shape.
//
// /signed-in is the terminal page for standalone logins, BUT a ceremony that still carries an
// OIDC/SAML protocol requestId must hand back to /authorize to finish the callback
// (createCallback → client ?code=). Verified against real Zitadel 2026-06-13.
//
// ZITADEL_API_URL/DEFAULT_APP_URL were `env` values the route reads and passes in as config;
// the original test mocked env to make them deterministic, so here we pass the same effective
// values directly via the config argument (consoleUrl = `${ZITADEL_API_URL}/ui/console`).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import { resolveSignedIn, type SignedInConfig } from '@/resources/session';
import { logAuthEvent } from '@/server/observability';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock observability so tests can intercept logAuthEvent calls.
vi.mock('@/server/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/observability')>();
  return { ...actual, logAuthEvent: vi.fn() };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost/id/signed-in';

const CONSOLE_URL = 'https://auth.localtest.me:30000/ui/console';

/** Mirrors the env values the route reads; per-test DEFAULT_APP_URL override sets defaultAppUrl. */
function makeConfig(defaultAppUrl?: string): SignedInConfig {
  return { consoleUrl: CONSOLE_URL, defaultAppUrl };
}

/** Build a signed sessions cookie carrying a single session entry. */
async function mintSessionsCookie(
  opts: { id?: string; token?: string; loginName?: string; organization?: string } = {}
) {
  const entry = {
    id: opts.id ?? 's1',
    token: opts.token ?? 't1',
    loginName: opts.loginName ?? 'alice@acme.test',
    organization: opts.organization,
    creationTs: '2026-01-01T00:00:00.000Z',
    expirationTs: '2099-01-01T00:00:00.000Z',
    changeTs: '2026-01-01T00:00:00.000Z',
  };
  return sessionsCookie.serialize([entry]);
}

/** Build a GET request for /signed-in, optionally with sessions cookie and search params. */
function makeRequest(search = '', sessionCookieHeader?: string): Request {
  const url = `${BASE_URL}${search}`;
  const headers: Record<string, string> = {};
  if (sessionCookieHeader) {
    // Strip Set-Cookie directives; keep only the name=value pair.
    headers['cookie'] = sessionCookieHeader.split(';')[0];
  }
  return new Request(url, { headers });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveSignedIn — protocol forward (regression)', () => {
  const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;

  it('forwards an oidc_ requestId to /authorize to complete the callback', async () => {
    const outcome = await resolveSignedIn(fake, makeRequest('?requestId=oidc_V2_1'), makeConfig());
    expect(outcome.kind).toBe('redirect');
    expect(outcome.kind === 'redirect' ? outcome.location : '').toContain(
      '/authorize?requestId=oidc_V2_1'
    );
  });

  it('forwards a saml_ requestId to /authorize', async () => {
    const outcome = await resolveSignedIn(fake, makeRequest('?requestId=saml_sr-1'), makeConfig());
    expect(outcome.kind).toBe('redirect');
    expect(outcome.kind === 'redirect' ? outcome.location : '').toContain(
      '/authorize?requestId=saml_sr-1'
    );
  });

  it('forwards a device_ requestId to /authorize (return-to-consent)', async () => {
    const outcome = await resolveSignedIn(
      fake,
      makeRequest('?requestId=device_WDJB-MJHT'),
      makeConfig()
    );
    expect(outcome.kind).toBe('redirect');
    expect(outcome.kind === 'redirect' ? outcome.location : '').toContain(
      '/authorize?requestId=device_WDJB-MJHT'
    );
  });
});

describe('resolveSignedIn — no-session redirect', () => {
  const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;

  it('redirects to /login when no active session is in the cookie', async () => {
    const outcome = await resolveSignedIn(fake, makeRequest(''), makeConfig()); // no cookie at all
    expect(outcome.kind).toBe('redirect');
    expect(outcome.kind === 'redirect' ? outcome.location : '').toBe('/login');
  });
});

describe('resolveSignedIn — post-login destination routing', () => {
  let fake: FakeAuthProvider;

  beforeEach(() => {
    vi.restoreAllMocks();
    fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    // Ensure no lingering admin designation between tests.
    fake.setInstanceAdminSession(null);
    // Seed a live session so isInstanceAdmin can verify the token.
    fake.seedLiveSession({ id: 's1', token: 't1' });
  });

  it('falls back to env DEFAULT_APP_URL when getLoginSettings rejects (no throw, no admin)', async () => {
    vi.spyOn(fake, 'getLoginSettings').mockRejectedValue(new Error('boom'));

    const cookieHeader = await mintSessionsCookie({ id: 's1', token: 't1', organization: 'org1' });
    const outcome = await resolveSignedIn(
      fake,
      makeRequest('', cookieHeader),
      makeConfig('https://app.example')
    );

    expect(outcome.kind).toBe('redirect');
    expect(outcome.kind === 'redirect' ? outcome.location : '').toBe('https://app.example');
  });

  it('instance admin → redirect to ZITADEL_API_URL/ui/console', async () => {
    fake.setInstanceAdminSession('s1');

    const cookieHeader = await mintSessionsCookie({ id: 's1', token: 't1' });
    const outcome = await resolveSignedIn(fake, makeRequest('', cookieHeader), makeConfig());

    expect(outcome.kind).toBe('redirect');
    expect(outcome.kind === 'redirect' ? outcome.location : '').toBe(
      'https://auth.localtest.me:30000/ui/console'
    );
  });

  it('non-admin + getLoginSettings returns defaultRedirectUri → redirect to that URI', async () => {
    // Override settingsByOrg so that org 'org1' returns a defaultRedirectUri.
    // Use vi.spyOn on the fake instance to return the desired settings.
    vi.spyOn(fake, 'getLoginSettings').mockResolvedValue({
      allowPassword: true,
      allowRegister: true,
      allowExternalIdp: true,
      passkeysType: 'allowed',
      forceMfa: false,
      passwordCheckLifetimeMs: 0,
      secondFactorCheckLifetimeMs: 0,
      multiFactorCheckLifetimeMs: 0,
      mfaInitSkipLifetimeMs: 0,
      defaultRedirectUri: 'https://portal.example',
    });

    const cookieHeader = await mintSessionsCookie({ id: 's1', token: 't1' });
    const outcome = await resolveSignedIn(fake, makeRequest('', cookieHeader), makeConfig());

    expect(outcome.kind).toBe('redirect');
    expect(outcome.kind === 'redirect' ? outcome.location : '').toBe('https://portal.example');
  });

  it('non-admin + no defaultRedirectUri + DEFAULT_APP_URL set → redirect to DEFAULT_APP_URL', async () => {
    const cookieHeader = await mintSessionsCookie({ id: 's1', token: 't1' });
    const outcome = await resolveSignedIn(
      fake,
      makeRequest('', cookieHeader),
      makeConfig('http://localhost:3001')
    );

    expect(outcome.kind).toBe('redirect');
    expect(outcome.kind === 'redirect' ? outcome.location : '').toBe('http://localhost:3001');
  });

  it('non-admin + no defaultRedirectUri + DEFAULT_APP_URL unset → "You are signed in" page (no redirect)', async () => {
    // DEFAULT_APP_URL is undefined (no defaultAppUrl in config).
    const cookieHeader = await mintSessionsCookie({
      id: 's1',
      token: 't1',
      loginName: 'alice@acme.test',
    });
    const outcome = await resolveSignedIn(fake, makeRequest('', cookieHeader), makeConfig());

    // Must NOT be a redirect (the route would render the terminal page, not 302).
    expect(outcome.kind).not.toBe('redirect');
    // And it must not be a /login redirect either (the page outcome carries no location at all).
    expect(outcome.kind === 'redirect' ? outcome.location : '').not.toContain('/login');
    // The terminal-page outcome must expose loginName (the "You are signed in" page payload).
    expect(outcome.kind).toBe('page');
    expect(outcome.kind === 'page' ? outcome.loginName : undefined).toBe('alice@acme.test');
  });
});

describe('resolveSignedIn — audit event emission (CODE-MAJ-05)', () => {
  let fake: FakeAuthProvider;
  const logAuthEventMock = vi.mocked(logAuthEvent);

  beforeEach(() => {
    vi.restoreAllMocks();
    logAuthEventMock.mockReset();
    fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    fake.setInstanceAdminSession(null);
    fake.seedLiveSession({ id: 's1', token: 't1' });
  });

  it('emits a post_login_settings failure event when getLoginSettings rejects', async () => {
    vi.spyOn(fake, 'getLoginSettings').mockRejectedValue(new Error('boom'));

    const cookieHeader = await mintSessionsCookie({ id: 's1', token: 't1', organization: 'org1' });
    await resolveSignedIn(fake, makeRequest('', cookieHeader), makeConfig('https://app.example'));

    const calls = logAuthEventMock.mock.calls.map(([event, outcome]) => ({ event, outcome }));
    expect(calls).toContainEqual({ event: 'post_login_settings', outcome: 'failure' });
  });
});
