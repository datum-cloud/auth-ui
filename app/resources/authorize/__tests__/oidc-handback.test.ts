// app/resources/authorize/__tests__/oidc-handback.test.ts
// @vitest-environment node
//
// node env: happy-dom enforces the Fetch spec rule that forbids setting the `Cookie`
// header on a Request object, which we need to drive resolveAuthorize with a live session.
//
// REGRESSION LOCK (reported bug): "can we make it auto redirect ? instead of back to accounts
// page and select the account again ?"
//
// When a login completion threads the authenticated session id back as
// `/authorize?requestId=oidc_<id>&sessionId=<live>`, resolveOidc's explicit-sessionId hand-back
// must finish the OIDC callback (createCallback → client ?code=) REGARDLESS of the request's
// prompt. Before the fix, completion paths that omitted sessionId fell into decideAuthorize and
// a prompt=select_account / prompt=login request bounced straight back to /accounts (or /login)
// — forcing the user to pick the account they had just authenticated with. This test pins the
// finalize-don't-bounce behavior at the resolveOidc layer.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import type { AuthRequest } from '@/modules/auth/types';
import { resolveAuthorize, outcomeToResponse } from '@/resources/authorize';
import { describe, it, expect } from 'vitest';

const SESSION = { id: 'sess-live-1', token: 'tok-live-1' };

/** Build a signed sessions cookie carrying a single live session entry. */
async function mintSessionsCookie() {
  return sessionsCookie.serialize([
    {
      id: SESSION.id,
      token: SESSION.token,
      loginName: 'alice@acme.test',
      creationTs: '2026-01-01T00:00:00.000Z',
      expirationTs: '2099-01-01T00:00:00.000Z',
      changeTs: '2026-01-01T00:00:00.000Z',
    },
  ]);
}

/**
 * Seed a fake provider with one OIDC auth request (keyed by the raw id — resolveOidc strips the
 * `oidc_` prefix before getAuthRequest) and one matching live cookie session.
 */
function seededProvider(prompt: AuthRequest['prompt']): FakeAuthProvider {
  const fake = new FakeAuthProvider({
    authRequests: { req1: { id: 'req1', clientId: 'client1', scopes: [], prompt } },
  });
  fake.seedLiveSession(SESSION);
  return fake;
}

/** Drive resolveAuthorize the way the route loader does and return the translated Response. */
async function run(provider: FakeAuthProvider, cookie: string, search: string): Promise<Response> {
  const request = new Request(`http://localhost/id/authorize${search}`, {
    headers: { cookie: cookie.split(';')[0] },
  });
  const outcome = await resolveAuthorize(provider, request);
  return outcomeToResponse(outcome, new URL(request.url));
}

describe('resolveOidc — explicit sessionId hand-back finalizes the callback (regression lock)', () => {
  it('prompt=select_account + threaded sessionId → finalizes (does NOT route to /accounts)', async () => {
    const provider = seededProvider(['select_account']);
    const cookie = await mintSessionsCookie();

    const res = await run(provider, cookie, `?requestId=oidc_req1&sessionId=${SESSION.id}`);

    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    // Finalized: redirect to the client callback URL with a ?code=, NOT the /accounts picker.
    expect(loc).toContain('client.acme.test/callback');
    expect(loc).toContain(`code=fake_req1_${SESSION.id}`);
    expect(loc).not.toContain('/accounts');
  });

  it('prompt=login + threaded sessionId → finalizes (does NOT route to /login)', async () => {
    const provider = seededProvider(['login']);
    const cookie = await mintSessionsCookie();

    const res = await run(provider, cookie, `?requestId=oidc_req1&sessionId=${SESSION.id}`);

    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('client.acme.test/callback');
    expect(loc).toContain(`code=fake_req1_${SESSION.id}`);
    expect(loc).not.toContain('/login');
  });

  it('control: prompt=select_account WITHOUT a threaded sessionId routes to /accounts', async () => {
    // Proves the bounce is real and that the sessionId hand-back is what suppresses it: the same
    // request without &sessionId falls into decideAuthorize → /accounts.
    const provider = seededProvider(['select_account']);
    const cookie = await mintSessionsCookie();

    const res = await run(provider, cookie, `?requestId=oidc_req1`);

    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('/accounts');
  });
});
