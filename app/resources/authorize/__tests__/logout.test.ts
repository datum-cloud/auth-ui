// Pass 2 service test (migrated from routes/authorize/__tests__/logout.test.ts).
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object (we mint a sessions cookie).
//
// Regression coverage for the post-logout stale-cookie bug (CCD root cause 15466):
// auth-ui's `sessions` cookie can outlive the Zitadel session — e.g. after RP-initiated
// logout cloud-portal revokes tokens + ends the OIDC session but never clears auth-ui's
// cookie. On the next /authorize the stale {id, token} was blindly reused in createCallback
// → Zitadel FAILED_PRECONDITION → mapped to ALREADY_DONE → generic /id/error.
//
// The fix validates session liveness via provider.getSession(entry.id, entry.token) BEFORE
// every createCallback, with three precise outcomes:
//   1. CONFIRMED DEAD (getSession → null, or ProviderError NOT_FOUND/PERMISSION_DENIED):
//      drop the stale entry, re-prompt /login, log a DISTINCT `session_stale` event.
//   2. TRANSIENT (any other ProviderError code, e.g. UNAVAILABLE): do NOT log out — surface
//      the error path so a Zitadel hiccup never silently re-logins a valid user.
//   3. ALIVE: proceed to createCallback exactly as before. A genuine ALREADY_DONE on a
//      confirmed-live session STILL surfaces as /id/error (diagnosability preserved).
//
// These cases now drive resolveAuthorize (the extracted loader logic) against the shared fake
// provider singleton, using the fake's additive test-control hooks (seedLiveSession /
// setSessionResult / setCallbackResult) to script getSession / createCallback per session id.
// The service's typed outcome is translated to a Response via outcomeToResponse — identical to
// what the route returns — so every redirect / set-cookie / audit-log assertion is preserved.
// All hooks are cleared in afterEach so the shared singleton stays clean for sibling test files.
import type { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import { resolveAuthorize, outcomeToResponse } from '@/resources/authorize';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;

// requestId `cb` is seeded in select.server.ts with prompt:[] → the OIDC callback path,
// so decideAuthorize routes to target:'callback' when a session is present (Path B). For
// Path A we additionally thread an explicit &sessionId=.
const RAW_ID = 'cb';

/** Mint a sessions cookie with one entry under the given id/token. */
async function mintCookie(id: string, token: string) {
  const entry = {
    id,
    token,
    loginName: 'alice@acme.test',
    creationTs: '2026-01-01T00:00:00.000Z',
    expirationTs: '2099-01-01T00:00:00.000Z',
    changeTs: '2026-01-01T00:00:00.000Z',
  };
  return sessionsCookie.serialize([entry]);
}

async function run(search: string, cookieHeader?: string) {
  const url = new URL(`http://localhost/id/authorize${search}`);
  const headers: Record<string, string> = {};
  if (cookieHeader) headers['cookie'] = cookieHeader.split(';')[0];
  const request = new Request(url.toString(), { headers });
  const outcome = await resolveAuthorize(fake, request);
  return outcomeToResponse(outcome, url);
}

/** Parse the entries back out of a Set-Cookie value (round-trips the HMAC). */
async function parseSetCookie(setCookie: string | null): Promise<unknown> {
  if (!setCookie) return null;
  return sessionsCookie.parse(setCookie.split(';')[0]);
}

// Track session ids we script so afterEach can reset the shared singleton cleanly.
const scripted = new Set<string>();

beforeEach(() => {
  scripted.clear();
});

afterEach(() => {
  for (const id of scripted) {
    fake.clearSessionResult(id);
    fake.clearCallbackResult(id);
    fake.removeLiveSession(id);
  }
  scripted.clear();
  vi.restoreAllMocks();
});

describe('/authorize — stale-cookie self-heal (validate before reuse)', () => {
  // ── DEAD SESSION → clean re-login (Path B: decideAuthorize → callback) ──────────────────
  it('dead session (getSession→null) re-prompts /login, drops the stale entry, logs session_stale — NOT /id/error', async () => {
    const id = 'stale-b';
    scripted.add(id);
    fake.setSessionResult(id, { mode: 'null' }); // confirmed dead

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logs.push(line);
    });

    const cookie = await mintCookie(id, 'tok-stale');
    const res = await run(`?requestId=oidc_${RAW_ID}`, cookie);

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    // Clean re-login (mirrors the SAML no-session bootstrap), threading the requestId.
    expect(location).toContain('/login');
    expect(location).toContain(`requestId=oidc_${RAW_ID}`);
    expect(location).not.toContain('/error'); // self-heal, NOT the generic ALREADY_DONE error page

    // Stale entry removed from the cookie.
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    const entries = (await parseSetCookie(setCookie)) as Array<{ id: string }> | null;
    expect(Array.isArray(entries) ? entries.some((e) => e.id === id) : false).toBe(false);

    // DISTINCT, traceable audit event — not confused with a genuine error.
    logSpy.mockRestore();
    const staleEvent = logs
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.event === 'session_stale');
    expect(staleEvent).toBeTruthy();
    expect(staleEvent.outcome).toBe('success');
    expect(staleEvent.sessionId).toBe(id);
    // It must NOT have emitted an oidc_callback failure for this self-heal.
    const callbackFailure = logs
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.event === 'oidc_callback' && e.outcome === 'failure');
    expect(callbackFailure).toBeFalsy();
  });

  // ── DEAD SESSION via ProviderError NOT_FOUND (Path A: explicit sessionId hand-back) ─────
  it('dead session (getSession throws NOT_FOUND) on the explicit sessionId path re-prompts /login + drops entry', async () => {
    const id = 'stale-a';
    scripted.add(id);
    fake.setSessionResult(id, { mode: 'throw', code: 'NOT_FOUND' });

    const cookie = await mintCookie(id, 'tok-stale-a');
    const res = await run(`?requestId=oidc_${RAW_ID}&sessionId=${id}`, cookie);

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain(`requestId=oidc_${RAW_ID}`);
    expect(location).not.toContain('/error');

    const entries = (await parseSetCookie(res.headers.get('set-cookie'))) as Array<{
      id: string;
    }> | null;
    expect(Array.isArray(entries) ? entries.some((e) => e.id === id) : false).toBe(false);
  });

  it('dead session (getSession throws PERMISSION_DENIED) is treated as dead → /login', async () => {
    const id = 'stale-perm';
    scripted.add(id);
    fake.setSessionResult(id, { mode: 'throw', code: 'PERMISSION_DENIED' });

    const cookie = await mintCookie(id, 'tok-perm');
    const res = await run(`?requestId=oidc_${RAW_ID}&sessionId=${id}`, cookie);

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).not.toContain('/error');
  });

  // ── LIVE SESSION + successful callback → unchanged happy path ───────────────────────────
  it('live session → createCallback runs → 302 to the callback URL (happy path unchanged)', async () => {
    const id = 'live-ok';
    scripted.add(id);
    fake.seedLiveSession({ id, token: 'tok-live-ok' }); // getSession returns a live session

    const cookie = await mintCookie(id, 'tok-live-ok');
    const res = await run(`?requestId=oidc_${RAW_ID}&sessionId=${id}`, cookie);

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    // Fake createCallback returns https://client.acme.test/callback?code=fake_<rawId>_<sessionId>
    expect(location).toContain('client.acme.test/callback');
    expect(location).toContain(`fake_${RAW_ID}_${id}`);
    expect(location).not.toContain('/login');
    expect(location).not.toContain('/error');
  });

  // ── LIVE SESSION + createCallback ALREADY_DONE → STILL errors (diagnosability) ──────────
  it('live session + createCallback throws ALREADY_DONE → STILL redirects to /id/error (genuine error NOT masked)', async () => {
    const id = 'live-already';
    scripted.add(id);
    fake.seedLiveSession({ id, token: 'tok-live-already' }); // session is CONFIRMED LIVE
    fake.setCallbackResult(id, { mode: 'throw', code: 'ALREADY_DONE' }); // but createCallback fails

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logs.push(line);
    });

    const cookie = await mintCookie(id, 'tok-live-already');
    const res = await run(`?requestId=oidc_${RAW_ID}&sessionId=${id}`, cookie);

    logSpy.mockRestore();

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    // A live-session ALREADY_DONE is a GENUINE bug — it must still surface, not self-heal.
    expect(location).toContain('/error');
    expect(location).not.toContain('/login');

    // And the failure must be logged with the code for diagnosability.
    const failure = logs
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.event === 'oidc_callback' && e.outcome === 'failure');
    expect(failure).toBeTruthy();
    expect(failure.code).toBe('ALREADY_DONE');
    // It must NOT have self-healed (no session_stale for a live session).
    const stale = logs
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.event === 'session_stale');
    expect(stale).toBeFalsy();
  });

  // ── TRANSIENT getSession error → NOT a silent re-login ──────────────────────────────────
  it('transient getSession error (UNAVAILABLE) does NOT log the user out — surfaces the error path', async () => {
    const id = 'transient';
    scripted.add(id);
    fake.setSessionResult(id, { mode: 'throw', code: 'UNAVAILABLE' });

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logs.push(line);
    });

    const cookie = await mintCookie(id, 'tok-transient');
    const res = await run(`?requestId=oidc_${RAW_ID}&sessionId=${id}`, cookie);

    logSpy.mockRestore();

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    // A transient Zitadel hiccup must NOT bootstrap a re-login and must NOT silently succeed.
    expect(location).not.toContain('/login');
    expect(location).toContain('/error');

    // And it must NOT have self-healed (no session_stale for a transient error).
    const stale = logs
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.event === 'session_stale');
    expect(stale).toBeFalsy();
  });
});
