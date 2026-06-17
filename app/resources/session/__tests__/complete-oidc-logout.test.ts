// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object.
import { serializeSessions } from '@/modules/auth/session/cookie';
import { completeOidcLogout } from '@/resources/session/session.service';
import { describe, it, expect, vi } from 'vitest';

// Build a request whose cookie carries sessions. serializeSessions produces the signed
// Set-Cookie; feed it back as the request Cookie header so completeOidcLogout reads them.
//
// Adaptation: SessionEntry requires creationTs and expirationTs (validated by Zod in
// readSessions). We supply safe defaults so the round-trip through serializeSessions →
// readSessions succeeds — the test assertions are unchanged.
async function reqWithSessions(
  entries: Array<{ id: string; token: string; loginName: string }>,
  qs = ''
) {
  const setCookie = await serializeSessions(
    entries.map((e) => ({
      ...e,
      changeTs: '1',
      creationTs: '2026-01-01T00:00:00.000Z',
      expirationTs: '2099-01-01T00:00:00.000Z',
      organization: undefined,
      requestId: undefined,
    }))
  );
  const cookie = setCookie.split(';')[0];
  return new Request(`https://auth.localtest.me:30000/id/logout${qs}`, { headers: { cookie } });
}

function fakeProvider(deleteSession = vi.fn(async () => undefined)) {
  return { deleteSession } as unknown as Parameters<typeof completeOidcLogout>[0];
}

describe('completeOidcLogout', () => {
  it('deletes ALL v2 sessions and clears the cookie', async () => {
    const provider = fakeProvider();
    const request = await reqWithSessions([
      { id: 's1', token: 't1', loginName: 'a@x.test' },
      { id: 's2', token: 't2', loginName: 'b@x.test' },
    ]);
    const outcome = await completeOidcLogout(provider, request);
    expect(provider.deleteSession).toHaveBeenCalledTimes(2);
    expect(provider.deleteSession).toHaveBeenCalledWith('s1', 't1');
    expect(provider.deleteSession).toHaveBeenCalledWith('s2', 't2');
    expect(outcome.setCookie).toContain('sessions=');
    expect(outcome.location).toBe('/logout/success');
  });

  it('tolerates provider deleteSession failures (best-effort) and still clears + redirects', async () => {
    const provider = fakeProvider(
      vi.fn(async () => {
        throw new Error('gone');
      })
    );
    const request = await reqWithSessions([{ id: 's1', token: 't1', loginName: 'a@x.test' }]);
    const outcome = await completeOidcLogout(provider, request);
    expect(outcome.location).toBe('/logout/success');
  });

  it('redirects to a same-origin post_logout_redirect when present', async () => {
    const provider = fakeProvider();
    const request = await reqWithSessions(
      [{ id: 's1', token: 't1', loginName: 'a@x.test' }],
      '?logout_token=x&post_logout_redirect=/logout/done'
    );
    const outcome = await completeOidcLogout(provider, request);
    expect(outcome.location).toBe('/logout/done');
  });
});
