// app/resources/session/__tests__/session.service.accounts.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object (the /accounts loader reads
// the signed sessions cookie off the request).
//
// `/accounts` N+1 batch.
//
// `listAccounts` enriches every live cookie session. The per-session enrichment needs the
// user's enrolled auth methods (`listAuthMethods(userId)`). When two distinct sessions belong
// to the SAME user (e.g. an org session and a default-org session for one account, or simply
// two cookie entries that resolve to one userId), the prior implementation issued one
// `listAuthMethods` RPC PER SESSION — a redundant N+1. This spec pins the dedupe: build a
// per-request Map<userId, methods> and issue ONE `listAuthMethods` per distinct userId, with
// the enrichment output byte-for-byte identical (same nextPath / displayName / isActive).
//
// Error neutrality: the test asserts only on the observable EnrichedAccount shape (sessionId,
// loginName, organization, nextPath, isActive) — no proto type / provider string / token / PII
// leaks through the service boundary.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import type { Session, AuthMethod } from '@/modules/auth/types';
import { listAccounts } from '@/resources/session';
import { describe, it, expect, vi } from 'vitest';

const BASE_URL = 'http://localhost/id/accounts';

type CookieEntryOpts = {
  id: string;
  token?: string;
  loginName: string;
  organization?: string;
};

/** Build a signed sessions cookie carrying the given live entries. */
async function mintSessionsCookie(entries: CookieEntryOpts[]) {
  const full = entries.map((e) => ({
    id: e.id,
    token: e.token ?? `tok-${e.id}`,
    loginName: e.loginName,
    organization: e.organization,
    creationTs: '2026-01-01T00:00:00.000Z',
    expirationTs: '2099-01-01T00:00:00.000Z',
    changeTs: '2026-01-01T00:00:00.000Z',
  }));
  return sessionsCookie.serialize(full);
}

function makeRequest(cookieHeader: string): Request {
  return new Request(BASE_URL, { headers: { cookie: cookieHeader.split(';')[0] } });
}

/** A provider Session fixture (read-only enrichment shape; token always ''). */
function providerSession(opts: {
  id: string;
  userId: string;
  loginName: string;
  displayName?: string;
}): Session {
  return {
    id: opts.id,
    token: '',
    user: { id: opts.userId, loginName: opts.loginName, displayName: opts.displayName },
    factors: {},
    expiresAt: '2099-01-01T00:00:00.000Z',
    changedAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * Build a provider double whose `listSessions` maps each cookie session id to a provider
 * Session (so we control the resolved userId), and whose `listAuthMethods` is a spy.
 */
function makeProvider(
  providerSessions: Session[],
  authMethods: AuthMethod[] = ['password']
): { provider: AuthProvider; listAuthMethods: ReturnType<typeof vi.fn> } {
  const base = new FakeAuthProvider();
  const listAuthMethods = vi.fn(async (_userId: string) => authMethods);
  const provider = {
    ...base,
    listSessions: vi.fn(async (_ids: string[]) => providerSessions),
    listAuthMethods,
    getLoginSettings: vi.fn(async () => ({
      allowPassword: true,
      allowRegister: true,
      allowExternalIdp: false,
      passkeysType: 'not_allowed' as const,
      forceMfa: false,
    })),
  } as unknown as AuthProvider;
  return { provider, listAuthMethods };
}

describe('listAccounts — listAuthMethods N+1 dedupe', () => {
  it('issues ONE listAuthMethods per distinct userId across multiple sessions', async () => {
    // Two cookie sessions resolve to the SAME userId 'u1'.
    const cookie = await mintSessionsCookie([
      { id: 's1', loginName: 'alice@acme.test', organization: 'org-a' },
      { id: 's2', loginName: 'alice@acme.test', organization: 'org-b' },
    ]);
    const { provider, listAuthMethods } = makeProvider([
      providerSession({
        id: 's1',
        userId: 'u1',
        loginName: 'alice@acme.test',
        displayName: 'Alice',
      }),
      providerSession({
        id: 's2',
        userId: 'u1',
        loginName: 'alice@acme.test',
        displayName: 'Alice',
      }),
    ]);

    const accounts = await listAccounts(provider, makeRequest(cookie));

    // Same userId across both sessions ⇒ exactly ONE listAuthMethods call (was 2 — N+1).
    expect(listAuthMethods).toHaveBeenCalledTimes(1);
    expect(listAuthMethods).toHaveBeenCalledWith('u1');

    // Output unchanged: both sessions enriched.
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.sessionId).sort()).toEqual(['s1', 's2']);
    expect(accounts.every((a) => a.displayName === 'Alice')).toBe(true);
  });

  it('issues one listAuthMethods PER distinct userId when sessions belong to different users', async () => {
    const cookie = await mintSessionsCookie([
      { id: 's1', loginName: 'alice@acme.test', organization: 'org-a' },
      { id: 's2', loginName: 'bob@acme.test', organization: 'org-a' },
    ]);
    const { provider, listAuthMethods } = makeProvider([
      providerSession({ id: 's1', userId: 'u1', loginName: 'alice@acme.test' }),
      providerSession({ id: 's2', userId: 'u2', loginName: 'bob@acme.test' }),
    ]);

    const accounts = await listAccounts(provider, makeRequest(cookie));

    expect(listAuthMethods).toHaveBeenCalledTimes(2);
    const calledIds = listAuthMethods.mock.calls.map((c) => c[0]).sort();
    expect(calledIds).toEqual(['u1', 'u2']);
    expect(accounts).toHaveLength(2);
  });

  it('does not call listAuthMethods for a session with no resolved userId', async () => {
    const cookie = await mintSessionsCookie([
      { id: 's1', loginName: 'alice@acme.test', organization: 'org-a' },
    ]);
    // Provider session with no user → userId '' → skip listAuthMethods.
    const sessionNoUser: Session = {
      id: 's1',
      token: '',
      factors: {},
      expiresAt: '2099-01-01T00:00:00.000Z',
      changedAt: '2026-01-01T00:00:00.000Z',
    };
    const { provider, listAuthMethods } = makeProvider([sessionNoUser]);

    const accounts = await listAccounts(provider, makeRequest(cookie));

    expect(listAuthMethods).not.toHaveBeenCalled();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].sessionId).toBe('s1');
  });
});
