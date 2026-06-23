// app/resources/session/__tests__/session.service.logout.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object.
//
// Pass 2: service-level rewrite of the former routes/logout/__tests__/logout.test.ts.
// Every behavioral assertion from that route test is preserved here, asserted directly at the
// service boundary (`performLogout` → typed LogoutOutcome.location) plus a thin check that
// `logoutOutcomeToResponse` emits the same redirect Location the route returns verbatim.
//
// CSRF is route-level wiring (assertCsrf stays in the thin route), so the service is called with
// a plain Request carrying only the sessions cookie — no CSRF round-trip is needed here. (The
// original route test minted CSRF only to satisfy the route's assertCsrf; the business logic
// under test is unchanged.)
//
// Verifies: after single-session logout, residual cookie sessions are not silently
// reusable — the post-logout redirect goes to /accounts (not /logout/success) so the user must
// explicitly choose a session rather than being re-authed silently.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import type { SessionEntry } from '@/modules/auth/session/cookie';
import { performLogout, logoutOutcomeToResponse } from '@/resources/session';
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost/id/logout';

const s1: SessionEntry = {
  id: 'sess-1',
  token: 'tok-1',
  loginName: 'alice@acme.test',
  creationTs: '2026-01-01T00:00:00.000Z',
  expirationTs: '2099-01-01T00:00:00.000Z',
  changeTs: '2026-01-02T00:00:00.000Z', // most recent → active
};

const s2: SessionEntry = {
  id: 'sess-2',
  token: 'tok-2',
  loginName: 'bob@acme.test',
  creationTs: '2026-01-01T00:00:00.000Z',
  expirationTs: '2099-01-01T00:00:00.000Z',
  changeTs: '2026-01-01T00:00:00.000Z', // older → residual
};

function fakeProvider(): FakeAuthProvider {
  return getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
}

/** Serialize a list of session entries into a cookie string. */
async function mintSessionsCookie(sessions: SessionEntry[]): Promise<string> {
  return sessionsCookie.serialize(sessions);
}

/**
 * Build a logout Request carrying a sessions cookie with the given entries (no CSRF round-trip:
 * assertCsrf stays in the thin route, so the service is exercised with the parsed request only).
 */
async function requestWithSessions(sessions: SessionEntry[]): Promise<Request> {
  const sessionCookieRaw = await mintSessionsCookie(sessions);
  const sessionCookieValue = sessionCookieRaw.split(';')[0];
  return new Request(BASE, {
    method: 'POST',
    headers: { cookie: sessionCookieValue },
  });
}

describe('performLogout — explicit session scope', () => {
  it('after single-session logout, residual sessions are not silently reused on resume', async () => {
    // s1 is most-recent (active), s2 is residual — after logout, s2 remains in the cookie.
    // The redirect must NOT go to /logout/success (which lets /authorize silently reuse s2);
    // it must require explicit account selection.
    const outcome = await performLogout(fakeProvider(), await requestWithSessions([s1, s2]));
    expect(outcome.location).toMatch(/prompt=select_account|\/accounts/);

    // Thin route-wiring check: the translator emits the same Location verbatim.
    const res = logoutOutcomeToResponse(outcome);
    expect(res.headers.get('location')).toMatch(/prompt=select_account|\/accounts/);
  });

  it('single-session logout (no residual) still redirects to /logout/success', async () => {
    const outcome = await performLogout(fakeProvider(), await requestWithSessions([s1]));
    expect(outcome.location).toContain('/logout/success');

    const res = logoutOutcomeToResponse(outcome);
    expect(res.headers.get('location')).toContain('/logout/success');
  });
});
