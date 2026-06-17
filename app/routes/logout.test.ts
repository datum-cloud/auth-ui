// app/routes/logout.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that
// forbids setting the `Cookie` header on a Request object.
//
// Verifies CODE-MAJ-10: after single-session logout, residual cookie sessions are not
// silently reusable — the post-logout redirect goes to /accounts (not /logout/success)
// so the user must explicitly choose a session rather than being re-authed silently.
import { action } from './logout';
import { getCsrfToken } from '@/server/csrf';
import { sessionsCookie } from '@/session/cookie';
import type { SessionEntry } from '@/session/cookie';
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

/**
 * Serialize a list of session entries into a cookie string.
 */
async function mintSessionsCookie(sessions: SessionEntry[]): Promise<string> {
  return sessionsCookie.serialize(sessions);
}

/**
 * Run the logout action with:
 *  - a sessions cookie carrying the given entries
 *  - an optional requestId form field
 */
async function runLogout({
  sessions,
  requestId,
}: {
  sessions: SessionEntry[];
  requestId?: string;
}): Promise<Response> {
  // Mint a real CSRF token+cookie pair so assertCsrf passes.
  const [csrfToken, csrfCookieHeader] = await getCsrfToken(new Request(BASE));
  const csrfCookieValue = csrfCookieHeader!.split(';')[0];

  const sessionCookieRaw = await mintSessionsCookie(sessions);
  const sessionCookieValue = sessionCookieRaw.split(';')[0];

  const formFields: Record<string, string> = { csrf: csrfToken };
  if (requestId) formFields['requestId'] = requestId;

  const body = new URLSearchParams(formFields);

  const request = new Request(BASE, {
    method: 'POST',
    headers: {
      // Both cookies must be present (CSRF + sessions)
      cookie: `${csrfCookieValue}; ${sessionCookieValue}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  return action({ request, params: {}, context: {} as never } as never) as Promise<Response>;
}

describe('logout — CODE-MAJ-10: explicit session scope', () => {
  it('after single-session logout, residual sessions are not silently reused on resume', async () => {
    // s1 is most-recent (active), s2 is residual — after logout, s2 remains in the cookie.
    // The redirect must NOT go to /logout/success (which lets /authorize silently reuse s2);
    // it must require explicit account selection.
    const res = await runLogout({ sessions: [s1, s2], requestId: 'oidc_abc' });
    expect(res.headers.get('location')).toMatch(/prompt=select_account|\/accounts/);
  });

  it('single-session logout (no residual) still redirects to /logout/success', async () => {
    const res = await runLogout({ sessions: [s1] });
    expect(res.headers.get('location')).toContain('/logout/success');
  });
});
