// Tests for the sso.$provider.callback loader — CODE-MAJ-04, CODE-MIN-05.
//
// The loader previously had no try/catch around the provider calls (retrieveIdpIntent,
// getUser, getSession, getLoginSettings, addIdpLink, createSession). A transient error
// produced a raw 500 with no failure audit event. This file verifies that:
//   • A ProviderError from retrieveIdpIntent redirects to /sso/:provider/error and logs idp.signin failure.
//
// CODE-MIN-05: the user-resolution block formerly called getUser(recent.id) first —
// semantically wrong because recent.id is a SESSION id, not a user id. It now resolves
// the user directly via getSession(recent.id, recent.token). The test below asserts that
// getUser is no longer called during session-user resolution.
//
// Harness shape: runCallbackLoader({ provider, query, retrieveIdpIntent, onAuthEvent })
// Stubs and the event collector are passed directly as DI arguments — no module-level
// mocking of logAuthEvent.
//
// @vitest-environment node
//
// node env: happy-dom enforces Fetch spec rules that forbid setting the Cookie header.
import { loader } from './sso.$provider.callback';
import type { FakeAuthProvider } from '@/providers/fake/fake-provider';
import { getAuthProvider } from '@/providers/select.server';
import { ProviderError } from '@/providers/types';
import type { IdpIntentResult } from '@/providers/types';
import { sessionsCookie } from '@/session/cookie';
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

function runCallbackLoader({
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
  return loader({ request, params: { provider }, context: {} as never } as never, {
    retrieveIdpIntent,
    onAuthEvent,
  });
}

// An IdpIntentResult that routes to 'register' (no existing userId, draft present,
// allowRegister=true) so the loader redirects to /signup without further provider calls.
const REGISTER_INTENT: IdpIntentResult = {
  userId: null,
  information: { idpId: 'idp-g', idpUserId: 'g-new', idpUserName: 'newbie' },
  draft: { email: 'newbie@idp.test', firstName: 'New', lastName: 'Bie' },
};

afterEach(() => vi.restoreAllMocks());

describe('sso.$provider.callback loader — provider error handling (CODE-MAJ-04)', () => {
  it('redirects to the SSO error page and logs idp.signin failure when retrieveIdpIntent throws', async () => {
    const events: Array<{ event: string; outcome: string }> = [];
    const res = await runCallbackLoader({
      provider: 'google',
      query: { id: 'intent1', token: 'tok' },
      retrieveIdpIntent: () => Promise.reject(new ProviderError('UNAVAILABLE', 'down')),
      onAuthEvent: (event, outcome) => events.push({ event, outcome }),
    });
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get('location')).toContain('/sso/google/error');
    expect(events).toContainEqual({ event: 'idp.signin', outcome: 'failure' });
  });
});

// ---------------------------------------------------------------------------
// CODE-MIN-05: resolve ceremony user via getSession, NOT getUser(sessionId)
// ---------------------------------------------------------------------------

describe('sso.$provider.callback loader — session-user resolution (CODE-MIN-05)', () => {
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

    // Act: loader with a REGISTER_INTENT (routes to /signup — no addIdpLink/createSession calls).
    const res = await runCallbackLoader({
      provider: 'google',
      query: { id: 'intent-new', token: 'tok' },
      retrieveIdpIntent: () => Promise.resolve(REGISTER_INTENT),
      onAuthEvent: () => {},
      sessionsCookieHeader: cookieHeader,
    });

    // Assert: redirected to /signup (register path) and getUser was NOT called for session resolution.
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get('location')).toContain('/signup');
    // getUser must not have been called with the session id (recent.id = 's1').
    const calledWithSessionId = getUserSpy.mock.calls.some(([id]) => id === 's1');
    expect(calledWithSessionId).toBe(false);
  });
});
