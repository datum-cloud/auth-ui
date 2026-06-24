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
import { FakeAuthProvider, FIXED_NOW } from '@/modules/auth/providers/fake/fake-provider';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import type { AuthRequest, Session } from '@/modules/auth/types';
import { resolveAuthorize, outcomeToResponse } from '@/resources/authorize';
import { describe, it, expect } from 'vitest';

const SESSION = { id: 'sess-live-1', token: 'tok-live-1' };

// seedLiveSession stamps factors at FIXED_NOW. Pin the loader's nowMs to FIXED_NOW so a seeded
// session reads as freshly authenticated for the prompt=login freshness gate — keeping these
// regression-lock cases deterministic instead of depending on wall-clock Date.now() (the fake's
// own MERGE-RULE warns finite windows against FIXED_NOW rot into time bombs).
const SEEDED_NOW_MS = Date.parse(FIXED_NOW);

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
  // Pin nowMs to the fixture clock so seedLiveSession factors are fresh (see SEEDED_NOW_MS).
  const outcome = await resolveAuthorize(provider, request, SEEDED_NOW_MS);
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

// ─────────────────────────────────────────────────────────────────────────────────
// SECURITY REGRESSION LOCK: prompt=login freshness gate against forged sessionId hand-back.
//
// `?requestId=oidc_<id>&sessionId=<live>` lets ANY caller hand back a live cookie session id.
// For prompt=login the Authorization Server explicitly demanded FRESH re-authentication this
// ceremony — so a stale-but-live session id appended to the URL MUST NOT finalize the callback;
// it must fall through to decideAuthorize, which routes prompt=login → /login (forced re-auth).
// select_account is harmless (you may pick your own live session), so the gate is scoped to
// prompt=login only.
// ─────────────────────────────────────────────────────────────────────────────────

const NOW_MS = Date.parse('2026-06-24T12:00:00.000Z');
const TEN_MIN_MS = 10 * 60 * 1000;
const FIVE_SEC_MS = 5 * 1000;

/**
 * A FakeAuthProvider whose getSession returns a session with a CONTROLLABLE
 * `factors.password.verifiedAt`. The shared fake hardcodes verifiedAt to FIXED_NOW, so it
 * cannot express a "stale relative to nowMs" factor — this inline stub fills that gap while
 * delegating createCallback/getAuthRequest to the real fake behaviour.
 */
class FreshnessProvider extends FakeAuthProvider {
  constructor(
    prompt: AuthRequest['prompt'],
    private readonly verifiedAtMs: number
  ) {
    super({ authRequests: { req1: { id: 'req1', clientId: 'client1', scopes: [], prompt } } });
  }

  override async getSession(id: string, _token: string): Promise<Session | null> {
    if (id !== SESSION.id) return null;
    return {
      id: SESSION.id,
      token: SESSION.token,
      factors: { password: { verifiedAt: new Date(this.verifiedAtMs) } },
      expiresAt: '2099-01-01T00:00:00.000Z',
      changedAt: '2026-01-01T00:00:00.000Z',
    };
  }
}

/** Drive resolveAuthorize with an injected nowMs (the route default is Date.now()). */
async function runAt(
  provider: FakeAuthProvider,
  cookie: string,
  search: string,
  nowMs: number
): Promise<Response> {
  const request = new Request(`http://localhost/id/authorize${search}`, {
    headers: { cookie: cookie.split(';')[0] },
  });
  const outcome = await resolveAuthorize(provider, request, nowMs);
  return outcomeToResponse(outcome, new URL(request.url));
}

describe('resolveOidc — prompt=login freshness gate (anti-forgery hardening)', () => {
  it('prompt=login + STALE handed-back session → does NOT finalize; routes to /login (re-auth)', async () => {
    // The security regression lock: a stale (10-min-old) live session forged onto a prompt=login
    // URL must NOT skip the forced re-authentication the AS asked for.
    const provider = new FreshnessProvider(['login'], NOW_MS - TEN_MIN_MS);
    const cookie = await mintSessionsCookie();

    const res = await runAt(
      provider,
      cookie,
      `?requestId=oidc_req1&sessionId=${SESSION.id}`,
      NOW_MS
    );

    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    // Did NOT finalize the callback — no client redirect / ?code=.
    expect(loc).not.toContain('client.acme.test/callback');
    expect(loc).not.toContain('code=');
    // Routed to forced re-auth, carrying the requestId so the ceremony resumes.
    expect(loc).toContain('/login');
    expect(loc).toContain('requestId=oidc_req1');
  });

  it('prompt=login + FRESH handed-back session → finalizes the callback (legitimate login)', async () => {
    // A genuinely fresh (5-sec-old) session satisfies prompt=login — the normal post-auth
    // finalize redirect must still work.
    const provider = new FreshnessProvider(['login'], NOW_MS - FIVE_SEC_MS);
    const cookie = await mintSessionsCookie();

    const res = await runAt(
      provider,
      cookie,
      `?requestId=oidc_req1&sessionId=${SESSION.id}`,
      NOW_MS
    );

    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('client.acme.test/callback');
    expect(loc).toContain(`code=fake_req1_${SESSION.id}`);
    expect(loc).not.toContain('/login');
  });

  it('prompt=select_account + STALE handed-back session → still finalizes (gate is login-only)', async () => {
    // Selecting your own live session is harmless: the gate must NOT apply to select_account,
    // even with a stale factor. Confirms the hardening is scoped to prompt=login.
    const provider = new FreshnessProvider(['select_account'], NOW_MS - TEN_MIN_MS);
    const cookie = await mintSessionsCookie();

    const res = await runAt(
      provider,
      cookie,
      `?requestId=oidc_req1&sessionId=${SESSION.id}`,
      NOW_MS
    );

    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('client.acme.test/callback');
    expect(loc).toContain(`code=fake_req1_${SESSION.id}`);
    expect(loc).not.toContain('/accounts');
  });
});
