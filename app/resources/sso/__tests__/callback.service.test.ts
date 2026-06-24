// Pass 2 service test (migrated from routes/sso/provider/__tests__/callback.test.ts).
// @vitest-environment node
//
// node env: happy-dom enforces Fetch spec rules that forbid setting the Cookie header.
//
// Tests the processIdpCallback service — the BUSINESS logic
// extracted from the /sso/:provider/callback loader. We drive the service directly with
// DI stubs + an event collector (no module-level mocking of logAuthEvent) and translate
// the typed outcome via outcomeToResponse, identical to what the route returns:
//   • A ProviderError from retrieveIdpIntent redirects to /sso/:provider/error and logs
//     idp.signin failure.
//   • The ceremony user is resolved via getSession (NOT getUser(sessionId)).
//   • Success paths (sign-in, auto-link, auto-create) emit a last-used-login Set-Cookie
//     with token idp:<idpId>. Non-success paths (link-needs-auth, error) emit none.
import type { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import { lastUsedLoginCookie } from '@/modules/auth/session/last-used-login';
import { ProviderError } from '@/modules/auth/types';
import type { IdpIntentResult } from '@/modules/auth/types';
import { processIdpCallback, outcomeToResponse } from '@/resources/sso';
import { logAuthEvent } from '@/server/observability';
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock observability so tests can intercept logAuthEvent calls (e.g. the PII-safe idp.link
// account-link-by-email decision log). Keep the rest of the module intact.
vi.mock('@/server/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/observability')>();
  return { ...actual, logAuthEvent: vi.fn() };
});

/** Parse the last-used-login token from a set-cookie header value, or null if absent. */
async function parseLastUsedCookie(setCookieHeader: string | null): Promise<string | null> {
  if (!setCookieHeader) return null;
  // The header may contain multiple cookies joined by ', '. Find the one for last-used-login.
  const cookies = setCookieHeader.split(', ');
  for (const cookie of cookies) {
    if (cookie.startsWith('last-used-login=')) {
      // Re-parse via the real cookie implementation to verify signature + decode value.
      const fakeReq = new Request('http://localhost', {
        headers: { cookie: cookie.split(';')[0] },
      });
      const val = await lastUsedLoginCookie.parse(fakeReq.headers.get('cookie'));
      if (val !== null && val !== undefined) return val as string;
    }
  }
  return null;
}

const BASE = 'http://localhost/id/sso';

interface RunCallbackOpts {
  provider: string;
  query: Record<string, string>;
  // Tightened to match the narrowed CallbackLoaderDeps.retrieveIdpIntent signature.
  retrieveIdpIntent: (id: string, token: string) => Promise<IdpIntentResult>;
  onAuthEvent: (event: string, outcome: string) => void;
  /** Optional signed sessions cookie value to plant on the request. */
  sessionsCookieHeader?: string;
}

async function runCallback({
  provider,
  query,
  retrieveIdpIntent,
  onAuthEvent,
  sessionsCookieHeader,
}: RunCallbackOpts) {
  const url = new URL(`${BASE}/${provider}/callback`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (sessionsCookieHeader) {
    headers['cookie'] = sessionsCookieHeader.split(';')[0];
  }
  const request = new Request(url.toString(), { headers });
  const authProvider = getAuthProvider({ AUTH_PROVIDER: 'fake' });
  const outcome = await processIdpCallback(authProvider, request, provider, {
    retrieveIdpIntent,
    onAuthEvent,
  });
  return outcomeToResponse(outcome);
}

// An IdpIntentResult that routes to 'register' (no existing userId, draft present,
// allowRegister=true) so the service redirects to /signup without further provider calls.
const REGISTER_INTENT: IdpIntentResult = {
  userId: null,
  information: { idpId: 'idp-g', idpUserId: 'g-new', idpUserName: 'newbie' },
  draft: { email: 'newbie@idp.test', firstName: 'New', lastName: 'Bie' },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(logAuthEvent).mockClear();
});

describe('processIdpCallback — provider error handling', () => {
  it('redirects to the SSO error page and logs idp.signin failure when retrieveIdpIntent throws', async () => {
    const events: Array<{ event: string; outcome: string }> = [];
    const res = (await runCallback({
      provider: 'google',
      query: { id: 'intent1', token: 'tok' },
      retrieveIdpIntent: () => Promise.reject(new ProviderError('UNAVAILABLE', 'down')),
      onAuthEvent: (event, outcome) => events.push({ event, outcome }),
    })) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/sso/google/error');
    expect(events).toContainEqual({ event: 'idp.signin', outcome: 'failure' });
  });
});

// ---------------------------------------------------------------------------
// Task-3: existingAccount lookup + link-needs-auth redirect with notice
// ---------------------------------------------------------------------------

// Base intent for the register path: no userId, draft present, emailVerified true.
const REGISTER_INTENT_VERIFIED: IdpIntentResult = {
  userId: null,
  information: { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'you@gmail.com' },
  draft: {
    email: 'you@gmail.com',
    firstName: 'You',
    lastName: 'User',
    emailVerified: true,
  },
};

describe('processIdpCallback — existing same-email account auto-link (Task-3)', () => {
  it('auto-links and signs in when existing account is passwordless + email is IdP-verified', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }],
      // no password seeded → listAuthMethods returns []
    });
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => REGISTER_INTENT_VERIFIED,
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    expect(res.status).toBe(302);
    // auto-link path: addIdpLink + createSession → signed-in or /authorize
    const loc = res.headers.get('location') ?? '';
    expect(loc === '/signed-in' || loc.startsWith('/authorize')).toBe(true);
    // session cookie must be set
    expect(res.headers.get('set-cookie')).toBeTruthy();
  });

  it('routes to /login with notice=link-existing when existing account has a password', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }],
      authMethods: { u1: ['password'] }, // has a password
    });
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => REGISTER_INTENT_VERIFIED,
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/login');
    expect(loc).toContain('notice=link-existing');
    expect(loc).toContain('loginName=you%40gmail.com');
    // must NOT have set a session cookie (no addIdpLink should have happened)
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).not.toContain('sess-');
  });

  it('auto-creates and signs in when no existing account with the same email (new IdP user)', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    // empty store → findUser returns null → auto-create path
    const provider = new FakeAuthProvider({});
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => REGISTER_INTENT_VERIFIED,
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    // new-user path: auto-create → sign in directly (no /signup/method hop)
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc === '/signed-in' || loc.startsWith('/authorize')).toBe(true);
    // session cookie must be set (user was created and signed in)
    expect(res.headers.get('set-cookie')).toBeTruthy();
    // the created user's email must be verified (IdP vouched for it)
    const newUser = await provider.findUser('you@gmail.com');
    expect(newUser).toBeDefined();
    expect(provider.isEmailVerified(newUser!.id)).toBe(true);
  });

  it('auto-creates a GitHub-style user with NO names by falling back to idpUserName', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({});
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    // GitHub draft: only the login, no given/family/display name.
    const githubIntent: IdpIntentResult = {
      userId: null,
      information: { idpId: 'idp-gh', idpUserId: 'gh-1', idpUserName: 'anindia0703' },
      draft: { email: 'gh-user@idp.test', emailVerified: true },
    };

    const request = new Request(
      'https://auth.localtest.me/sso/github/callback?id=intent-1&token=tok-1'
    );
    const outcome = await processIdpCallback(provider, request, 'github', {
      retrieveIdpIntent: async () => githubIntent,
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    // Register succeeded (non-empty names → no Zitadel GivenName length rejection).
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc === '/signed-in' || loc.startsWith('/authorize')).toBe(true);

    // The created user carries the derived (idpUserName) given/family — the fake stores
    // displayName as `${firstName} ${lastName}`, so both must be the login, not empty.
    const newUser = await provider.findUser('gh-user@idp.test');
    expect(newUser).toBeDefined();
    expect(newUser!.displayName).toBe('anindia0703 anindia0703');
  });
});

// ---------------------------------------------------------------------------
// Account-link-by-email observability: a fresh external IdP whose verified email matches an
// existing account emits a PII-safe idp.link log (needs_auth when the account has a password,
// auto_linked when it is passwordless). Booleans + ids only — never the raw email/loginName.
// ---------------------------------------------------------------------------

describe('processIdpCallback — account-link-by-email observability log', () => {
  it('emits idp.link failure reason=needs_auth (PII-safe) for the link-needs-auth decision', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }],
      authMethods: { u1: ['password'] }, // has a password → link-needs-auth decision
    });
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => REGISTER_INTENT_VERIFIED,
      onAuthEvent: () => {},
    });
    outcomeToResponse(outcome);

    // The account-link decision log fired with the snake_case needs_auth reason + PII-safe fields.
    expect(logAuthEvent).toHaveBeenCalledWith(
      'idp.link',
      'failure',
      expect.objectContaining({
        reason: 'needs_auth',
        idpId: 'idp-g',
        emailVerified: true,
        existingHasPassword: true,
      })
    );

    // Defense-in-depth: no idp.link account-link log carried the raw email/loginName.
    const linkCalls = vi.mocked(logAuthEvent).mock.calls.filter(([event]) => event === 'idp.link');
    expect(linkCalls.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(linkCalls);
    expect(serialized).not.toContain('you@gmail.com');
  });

  it('emits idp.link success reason=auto_linked (PII-safe) for the auto-link decision', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }],
      // no password seeded → listAuthMethods returns [] → auto-link decision
    });
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => REGISTER_INTENT_VERIFIED,
      onAuthEvent: () => {},
    });
    outcomeToResponse(outcome);

    // The account-link decision log fired with the snake_case auto_linked reason.
    expect(logAuthEvent).toHaveBeenCalledWith(
      'idp.link',
      'success',
      expect.objectContaining({
        reason: 'auto_linked',
        idpId: 'idp-g',
      })
    );

    // No idp.link account-link log carried the raw email/loginName.
    const linkCalls = vi.mocked(logAuthEvent).mock.calls.filter(([event]) => event === 'idp.link');
    const serialized = JSON.stringify(linkCalls);
    expect(serialized).not.toContain('you@gmail.com');
  });
});

// ---------------------------------------------------------------------------
// Task-6: mark email verified on IdP auto-link
// ---------------------------------------------------------------------------

describe('processIdpCallback — mark email verified on auto-link (Task-6)', () => {
  it('calls markEmailVerified with the account userId and draft email after a successful auto-link', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }],
      // no password seeded → listAuthMethods returns [] → auto-link decision
    });
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => REGISTER_INTENT_VERIFIED,
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    // auto-link succeeded → redirect
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc === '/signed-in' || loc.startsWith('/authorize')).toBe(true);

    // The account's email must now be marked verified via the fake's observable state.
    expect(provider.isEmailVerified('u1')).toBe(true);
  });

  it('does NOT mark email verified on a plain link ceremony (link=true)', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    // Seed the user as already linked so decideIdpCallback returns 'link' (not 'auto-link').
    const provider = new FakeAuthProvider({
      users: [{ id: 'u2', loginName: 'you@gmail.com', displayName: 'You User' }],
      // no password, but link=true forces the 'link' ceremony path
    });
    // Seed the intent so userId is known (direct link path — intent.userId set)
    const LINK_INTENT: IdpIntentResult = {
      userId: 'u2',
      information: { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'you@gmail.com' },
      draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
    };
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1&link=true'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => LINK_INTENT,
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    // link ceremony succeeded → redirect
    expect(res.status).toBe(302);

    // email must NOT have been marked verified via markEmailVerified
    expect(provider.isEmailVerified('u2')).toBe(false);
  });

  it('still redirects even if markEmailVerified throws (best-effort)', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({
      users: [{ id: 'u3', loginName: 'you@gmail.com', displayName: 'You User' }],
    });
    // Inject a failing markEmailVerified
    vi.spyOn(provider, 'markEmailVerified').mockRejectedValue(new Error('Zitadel SetEmail failed'));
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => ({
        ...REGISTER_INTENT_VERIFIED,
        draft: { ...REGISTER_INTENT_VERIFIED.draft!, email: 'you@gmail.com' },
      }),
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    // must still succeed — the markEmailVerified failure must not abort the link+sign-in
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc === '/signed-in' || loc.startsWith('/authorize')).toBe(true);
    expect(res.headers.get('set-cookie')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Stale-session resilience: a stale/expired sessions cookie must not abort a
// fresh IdP sign-in (getSession throws NOT_FOUND → tolerate, treat as no user)
// ---------------------------------------------------------------------------

describe('processIdpCallback — stale ceremony-session cookie resilience', () => {
  it('proceeds with a fresh IdP sign-in when the sessions cookie entry causes getSession to throw', async () => {
    // Arrange: plant a sessions cookie with ONE stale entry.
    const cookieHeader = await sessionsCookie.serialize([
      {
        id: 'stale-session',
        token: 'stale-token',
        loginName: 'stale@example.test',
        creationTs: '2020-01-01T00:00:00.000Z',
        expirationTs: '2020-01-02T00:00:00.000Z',
        changeTs: '2020-01-01T00:00:00.000Z',
      },
    ]);

    // Stub getSession to throw NOT_FOUND (as Zitadel does for expired sessions).
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'getSession').mockRejectedValue(
      new ProviderError('NOT_FOUND', 'Session not found')
    );

    // Drive a NEW-user intent (userId: null, draft with email that findUser returns null for).
    const res = (await runCallback({
      provider: 'google',
      query: { id: 'intent-fresh', token: 'tok-fresh' },
      retrieveIdpIntent: () => Promise.resolve(REGISTER_INTENT),
      onAuthEvent: () => {},
      sessionsCookieHeader: cookieHeader,
    })) as Response;

    // Assert: must NOT redirect to /sso/…/error?reason=request_expired.
    // New-user path now auto-creates and signs in directly (no /signup/method hop).
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).not.toContain('/error');
    expect(loc).not.toContain('request_expired');
    // auto-create path → signed-in or /authorize
    expect(loc === '/signed-in' || loc.startsWith('/authorize')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// last-used-login cookie: written on success paths, absent on non-success paths
// ---------------------------------------------------------------------------

describe('processIdpCallback — last-used-login Set-Cookie', () => {
  const IDP_ID = 'idp-g';

  it('emits idp:<idpId> last-used-login cookie on the sign-in path', async () => {
    // Arrange: seed an already-linked user so intent.userId is set → sign-in path.
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({
      users: [{ id: 'u-signin', loginName: 'linked@idp.test', displayName: 'Linked User' }],
    });
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const SIGN_IN_INTENT: IdpIntentResult = {
      userId: 'u-signin',
      information: { idpId: IDP_ID, idpUserId: 'g-linked', idpUserName: 'linked@idp.test' },
      draft: null,
    };

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-si&token=tok-si'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => SIGN_IN_INTENT,
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    expect(res.status).toBe(302);
    const lastUsed = await parseLastUsedCookie(res.headers.get('set-cookie'));
    expect(lastUsed).toBe(`idp:${IDP_ID}`);
  });

  it('emits idp:<idpId> last-used-login cookie on the auto-link path', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({
      users: [{ id: 'u-autolink', loginName: 'you@gmail.com', displayName: 'You User' }],
      // no password → auto-link path
    });
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const AUTOLINK_INTENT: IdpIntentResult = {
      userId: null,
      information: { idpId: IDP_ID, idpUserId: 'g-al', idpUserName: 'you@gmail.com' },
      draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
    };

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-al&token=tok-al'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => AUTOLINK_INTENT,
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc === '/signed-in' || loc.startsWith('/authorize')).toBe(true);
    const lastUsed = await parseLastUsedCookie(res.headers.get('set-cookie'));
    expect(lastUsed).toBe(`idp:${IDP_ID}`);
  });

  it('emits idp:<idpId> last-used-login cookie on the auto-create path', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    // Empty store → auto-create path.
    const provider = new FakeAuthProvider({});
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const AUTOCREATE_INTENT: IdpIntentResult = {
      userId: null,
      information: { idpId: IDP_ID, idpUserId: 'g-new', idpUserName: 'newbie@idp.test' },
      draft: { email: 'newbie@idp.test', firstName: 'New', lastName: 'Bie', emailVerified: true },
    };

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-ac&token=tok-ac'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => AUTOCREATE_INTENT,
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc === '/signed-in' || loc.startsWith('/authorize')).toBe(true);
    const lastUsed = await parseLastUsedCookie(res.headers.get('set-cookie'));
    expect(lastUsed).toBe(`idp:${IDP_ID}`);
  });

  it('does NOT emit a last-used-login cookie on the link-needs-auth path', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({
      users: [{ id: 'u-lna', loginName: 'you@gmail.com', displayName: 'You User' }],
      authMethods: { 'u-lna': ['password'] }, // has a password → link-needs-auth
    });
    const { processIdpCallback, outcomeToResponse } = await import('@/resources/sso');

    const LNA_INTENT: IdpIntentResult = {
      userId: null,
      information: { idpId: IDP_ID, idpUserId: 'g-lna', idpUserName: 'you@gmail.com' },
      draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
    };

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-lna&token=tok-lna'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => LNA_INTENT,
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    // link-needs-auth → redirect to /login with notice, no session cookie, no last-used cookie.
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('notice=link-existing');
    const lastUsed = await parseLastUsedCookie(res.headers.get('set-cookie'));
    expect(lastUsed).toBeNull();
  });

  it('does NOT emit a last-used-login cookie on the provider-error path', async () => {
    const res = (await runCallback({
      provider: 'google',
      query: { id: 'intent-err', token: 'tok-err' },
      retrieveIdpIntent: () => Promise.reject(new ProviderError('UNAVAILABLE', 'down')),
      onAuthEvent: () => {},
    })) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/sso/google/error');
    const lastUsed = await parseLastUsedCookie(res.headers.get('set-cookie'));
    expect(lastUsed).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 755-J1: link/auto-link failure reason mapping
//
// When addIdpLink throws ProviderError('ALREADY_EXISTS') the IdP identity is already linked to a
// DIFFERENT Datum account. The catch block must surface the DISTINCT reason
// 'identity-linked-elsewhere' (reusing the access-denied copy) instead of collapsing into the
// generic providerErrorCode → 'signin_failed'. Any OTHER ProviderError still maps through
// providerErrorCode so the special-case is narrow.
// ---------------------------------------------------------------------------

describe('processIdpCallback — 755-J1 link failure reason mapping', () => {
  // A passwordless same-email user + IdP-verified email drives the auto-link branch, whose catch
  // block carries the same ALREADY_EXISTS special-case as the plain link branch.
  const AUTOLINK_INTENT: IdpIntentResult = {
    userId: null,
    information: { idpId: 'idp-g', idpUserId: 'g-al', idpUserName: 'you@gmail.com' },
    draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
  };

  it('maps ALREADY_EXISTS to reason=identity-linked-elsewhere (not signin_failed)', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }],
      // no password → auto-link decision
    });
    // The identity is already linked elsewhere → addIdpLink rejects with ALREADY_EXISTS.
    vi.spyOn(provider, 'addIdpLink').mockRejectedValue(
      new ProviderError('ALREADY_EXISTS', 'identity already linked to another user')
    );
    const events: Array<{ event: string; outcome: string }> = [];

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => AUTOLINK_INTENT,
      onAuthEvent: (event, outcome) => events.push({ event, outcome }),
    });
    const res = outcomeToResponse(outcome) as Response;

    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/sso/google/error');
    expect(loc).toContain('reason=identity-linked-elsewhere');
    // Must NOT collapse into the generic signin_failed copy.
    expect(loc).not.toContain('reason=signin_failed');
    // The failure is still audited as an idp.link failure.
    expect(events).toContainEqual({ event: 'idp.link', outcome: 'failure' });
    // No session cookie on the failure path.
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).not.toContain('sess-');
  });

  it('maps a non-ALREADY_EXISTS link ProviderError through providerErrorCode (signin_failed)', async () => {
    const { FakeAuthProvider } = await import('@/modules/auth/providers/fake/fake-provider');
    const provider = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }],
    });
    // A generic provider failure (e.g. precondition) → generic reason, NOT the J1 special-case.
    vi.spyOn(provider, 'addIdpLink').mockRejectedValue(
      new ProviderError('FAILED_PRECONDITION', 'link rejected')
    );

    const request = new Request(
      'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1'
    );
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => AUTOLINK_INTENT,
      onAuthEvent: () => {},
    });
    const res = outcomeToResponse(outcome) as Response;

    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/sso/google/error');
    expect(loc).toContain('reason=signin_failed');
    expect(loc).not.toContain('identity-linked-elsewhere');
  });
});

// ---------------------------------------------------------------------------
// Resolve ceremony user via getSession, NOT getUser(sessionId)
// ---------------------------------------------------------------------------

describe('processIdpCallback — session-user resolution', () => {
  it('resolves the ceremony user via getSession, not getUser(sessionId)', async () => {
    // Arrange: plant a sessions cookie so mostRecent(entries) returns { id:'s1', token:'t1' }.
    const cookieHeader = await sessionsCookie.serialize([
      {
        id: 's1',
        token: 't1',
        loginName: 'alice@acme.test',
        creationTs: '2026-01-01T00:00:00.000Z',
        expirationTs: '2099-01-01T00:00:00.000Z',
        changeTs: '2026-01-01T00:00:00.000Z',
      },
    ]);

    // Spy on the fake provider singleton so we can count getUser calls and stub getSession.
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const getUserSpy = vi.spyOn(fake, 'getUser');
    vi.spyOn(fake, 'getSession').mockResolvedValue({
      id: 's1',
      token: 't1',
      user: { id: 'u1', loginName: 'alice@acme.test', displayName: 'Alice' },
      factors: {},
      expiresAt: '2099-01-01T00:00:00.000Z',
      changedAt: '2026-01-01T00:00:00.000Z',
    });

    // Act: service with a REGISTER_INTENT (routes to /signup — no addIdpLink/createSession calls).
    const res = (await runCallback({
      provider: 'google',
      query: { id: 'intent-new', token: 'tok' },
      retrieveIdpIntent: () => Promise.resolve(REGISTER_INTENT),
      onAuthEvent: () => {},
      sessionsCookieHeader: cookieHeader,
    })) as Response;

    // Assert: the callback resolves (redirects somewhere) and getUser was NOT called
    // with the session id 's1' (the regression this test guards against).
    expect(res.status).toBe(302);
    const loc2 = res.headers.get('location') ?? '';
    // Must not redirect to an error page (session resolution must not throw).
    expect(loc2).not.toContain('/error');
    // getUser must not have been called with the session id (recent.id = 's1').
    const calledWithSessionId = getUserSpy.mock.calls.some(([id]) => id === 's1');
    expect(calledWithSessionId).toBe(false);
  });
});
