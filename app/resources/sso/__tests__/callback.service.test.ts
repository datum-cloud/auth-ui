// Pass 2 service test (migrated from routes/sso/provider/__tests__/callback.test.ts).
// @vitest-environment node
//
// node env: happy-dom enforces Fetch spec rules that forbid setting the Cookie header.
//
// Tests the processIdpCallback service (CODE-MAJ-04, CODE-MIN-05) — the BUSINESS logic
// extracted from the /sso/:provider/callback loader. We drive the service directly with
// DI stubs + an event collector (no module-level mocking of logAuthEvent) and translate
// the typed outcome via outcomeToResponse, identical to what the route returns:
//   • A ProviderError from retrieveIdpIntent redirects to /sso/:provider/error and logs
//     idp.signin failure.
//   • The ceremony user is resolved via getSession (NOT getUser(sessionId)) — CODE-MIN-05.
import type { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import { ProviderError } from '@/modules/auth/types';
import type { IdpIntentResult } from '@/modules/auth/types';
import { processIdpCallback, outcomeToResponse } from '@/resources/sso';
import { describe, it, expect, vi, afterEach } from 'vitest';

const BASE = 'http://localhost/id/sso';

interface RunCallbackOpts {
  provider: string;
  query: Record<string, string>;
  // CODE-MIN-03: tightened to match the narrowed CallbackLoaderDeps.retrieveIdpIntent signature.
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

afterEach(() => vi.restoreAllMocks());

describe('processIdpCallback — provider error handling (CODE-MAJ-04)', () => {
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
// CODE-MIN-05: resolve ceremony user via getSession, NOT getUser(sessionId)
// ---------------------------------------------------------------------------

describe('processIdpCallback — session-user resolution (CODE-MIN-05)', () => {
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

    // Assert: redirected to /signup/method (register path) and getUser was NOT called for session resolution.
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/signup/method');
    // Regression guard: /signup/method reads `loginName` (the email is the loginName),
    // so the IdP draft email MUST ride as `loginName=` — `email=` arrives empty and 400s.
    expect(res.headers.get('location')).toContain('loginName=');
    // getUser must not have been called with the session id (recent.id = 's1').
    const calledWithSessionId = getUserSpy.mock.calls.some(([id]) => id === 's1');
    expect(calledWithSessionId).toBe(false);
  });
});
