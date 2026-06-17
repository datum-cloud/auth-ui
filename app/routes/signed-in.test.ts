// /signed-in is the terminal page for standalone logins, BUT a ceremony that still
// carries an OIDC/SAML protocol requestId must hand back to /authorize to finish the
// callback (createCallback → client ?code=). Verified against real Zitadel 2026-06-13.
//
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object.
import { loader } from './signed-in';
import { FakeAuthProvider } from '@/providers/fake/fake-provider';
import { getAuthProvider } from '@/providers/select.server';
import { logAuthEvent } from '@/server/observability';
import { sessionsCookie } from '@/session/cookie';
import { env } from '@/utils/env.server';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock env.server so ZITADEL_API_URL is deterministic in all tests.
// DEFAULT_APP_URL is set per-test by overriding env after import.
vi.mock('@/utils/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/env.server')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZITADEL_API_URL: 'https://auth.localtest.me:30000',
      DEFAULT_APP_URL: undefined,
    },
  };
});

// Mock observability so tests can intercept logAuthEvent calls.
vi.mock('@/server/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/observability')>();
  return { ...actual, logAuthEvent: vi.fn() };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost/id/signed-in';

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
async function makeRequest(search = '', sessionCookieHeader?: string): Promise<Request> {
  const url = `${BASE_URL}${search}`;
  const headers: Record<string, string> = {};
  if (sessionCookieHeader) {
    // Strip Set-Cookie directives; keep only the name=value pair.
    headers['cookie'] = sessionCookieHeader.split(';')[0];
  }
  return new Request(url, { headers });
}

function runLoader(request: Request) {
  return loader({ request, params: {}, context: {} as never } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/signed-in — protocol forward (regression)', () => {
  it('forwards an oidc_ requestId to /authorize to complete the callback', async () => {
    const res = (await runLoader(await makeRequest('?requestId=oidc_V2_1'))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('/authorize?requestId=oidc_V2_1');
  });

  it('forwards a saml_ requestId to /authorize', async () => {
    const res = (await runLoader(await makeRequest('?requestId=saml_sr-1'))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('/authorize?requestId=saml_sr-1');
  });

  it('forwards a device_ requestId to /authorize (return-to-consent)', async () => {
    const res = (await runLoader(await makeRequest('?requestId=device_WDJB-MJHT'))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('/authorize?requestId=device_WDJB-MJHT');
  });
});

describe('/signed-in — no-session redirect', () => {
  it('redirects to /login when no active session is in the cookie', async () => {
    const req = await makeRequest(''); // no cookie at all
    const res = (await runLoader(req)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });
});

describe('/signed-in — post-login destination routing', () => {
  let fake: FakeAuthProvider;

  beforeEach(() => {
    vi.restoreAllMocks();
    fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    // Ensure no lingering admin designation between tests.
    fake.setInstanceAdminSession(null);
    // Seed a live session so isInstanceAdmin can verify the token.
    fake.seedLiveSession({ id: 's1', token: 't1' });
    // Reset DEFAULT_APP_URL to undefined between tests.
    (env as Record<string, unknown>).DEFAULT_APP_URL = undefined;
  });

  it('falls back to env DEFAULT_APP_URL when getLoginSettings rejects (no throw, no admin)', async () => {
    (env as Record<string, unknown>).DEFAULT_APP_URL = 'https://app.example';
    vi.spyOn(fake, 'getLoginSettings').mockRejectedValue(new Error('boom'));

    const cookieHeader = await mintSessionsCookie({ id: 's1', token: 't1', organization: 'org1' });
    const res = (await runLoader(await makeRequest('', cookieHeader))) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example');
  });

  it('instance admin → 302 to ZITADEL_API_URL/ui/console', async () => {
    fake.setInstanceAdminSession('s1');

    const cookieHeader = await mintSessionsCookie({ id: 's1', token: 't1' });
    const res = (await runLoader(await makeRequest('', cookieHeader))) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://auth.localtest.me:30000/ui/console');
  });

  it('non-admin + getLoginSettings returns defaultRedirectUri → 302 to that URI', async () => {
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
    const res = (await runLoader(await makeRequest('', cookieHeader))) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://portal.example');
  });

  it('non-admin + no defaultRedirectUri + DEFAULT_APP_URL set → 302 to DEFAULT_APP_URL', async () => {
    (env as Record<string, unknown>).DEFAULT_APP_URL = 'http://localhost:3001';

    const cookieHeader = await mintSessionsCookie({ id: 's1', token: 't1' });
    const res = (await runLoader(await makeRequest('', cookieHeader))) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3001');
  });

  it('non-admin + no defaultRedirectUri + DEFAULT_APP_URL unset → renders "You are signed in" page (no redirect)', async () => {
    // env.DEFAULT_APP_URL is undefined (set in beforeEach).
    const cookieHeader = await mintSessionsCookie({
      id: 's1',
      token: 't1',
      loginName: 'alice@acme.test',
    });
    const res = await runLoader(await makeRequest('', cookieHeader));

    // data() responses are NOT a Response (no .status / no redirect); they are plain objects.
    // They don't have a 302 status — assert it's not a redirect.
    const asResponse = res as Response;
    expect(asResponse.status).not.toBe(302);
    // And it must not be a /login redirect either.
    expect(asResponse.headers?.get?.('location') ?? '').not.toContain('/login');
    // The loader must have returned a data payload exposing loginName (the "You are signed in" page).
    // React Router's data() wraps the value in DataWithResponseInit; the actual payload is on .data.
    const payload = (res as unknown as { data: { loginName: string | null; csrfToken: string } })
      .data;
    expect(payload).toHaveProperty('loginName', 'alice@acme.test');
  });
});

describe('/signed-in — audit event emission (CODE-MAJ-05)', () => {
  let fake: FakeAuthProvider;
  const logAuthEventMock = vi.mocked(logAuthEvent);

  beforeEach(() => {
    vi.restoreAllMocks();
    logAuthEventMock.mockReset();
    fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    fake.setInstanceAdminSession(null);
    fake.seedLiveSession({ id: 's1', token: 't1' });
    (env as Record<string, unknown>).DEFAULT_APP_URL = 'https://app.example';
  });

  it('emits a post_login_settings failure event when getLoginSettings rejects', async () => {
    vi.spyOn(fake, 'getLoginSettings').mockRejectedValue(new Error('boom'));

    const cookieHeader = await mintSessionsCookie({ id: 's1', token: 't1', organization: 'org1' });
    await runLoader(await makeRequest('', cookieHeader));

    const calls = logAuthEventMock.mock.calls.map(([event, outcome]) => ({ event, outcome }));
    expect(calls).toContainEqual({ event: 'post_login_settings', outcome: 'failure' });
  });
});
