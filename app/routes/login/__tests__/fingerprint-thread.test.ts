// app/routes/login/__tests__/fingerprint-thread.test.ts
// @vitest-environment node
//
// node env: happy-dom forbids setting the Cookie header (breaks the CSRF round-trip).
//
// The identifier action ensures the fingerprintId cookie exists. A browser that never
// carried it (cleared cookies / never visited the old app) gets a fresh fingerprintId
// minted and Set-Cookie'd on the SAME response that persists the ceremony session — so
// the very first session already carries a fingerprintId (no first-session gap). A
// browser that already carries the cookie is reused (no new fingerprintId Set-Cookie).
import { action as loginAction } from '@/routes/login/index';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect } from 'vitest';

async function mintCsrf(path: string) {
  const [token, cookie] = await getCsrfToken(new Request(`http://localhost${path}`));
  return { token, cookie: cookie! };
}

function postRequest(path: string, fields: Record<string, string>, cookies: string[]): Request {
  const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { cookie: cookieHeader, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

function args(request: Request) {
  return { request, params: {}, context: {} as never } as never;
}

/** All set-cookie header values from a Response (undici exposes getSetCookie). */
function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

describe('fingerprintId cookie thread through the /login identifier action', () => {
  it('cookie ABSENT: mints a fingerprintId Set-Cookie alongside the session cookie', async () => {
    const { token, cookie } = await mintCsrf('/id/login');
    const req = postRequest('/id/login', { csrf: token, loginName: 'alice@acme.test' }, [cookie]);

    const res = (await loginAction(args(req))) as Response;
    expect(res.status).toBe(302);

    const cookies = setCookies(res);
    // Session cookie is set...
    expect(cookies.some((c) => c.startsWith('sessions='))).toBe(true);
    // ...and a freshly-minted fingerprintId rides out on the same response.
    const fp = cookies.find((c) => c.startsWith('fingerprintId='));
    expect(fp).toBeDefined();
    const value = decodeURIComponent(fp!.split(';')[0].slice('fingerprintId='.length));
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Old-app attributes preserved.
    expect(fp).toContain('Max-Age=31536000');
    expect(fp).toContain('Path=/');
    expect(fp).toContain('HttpOnly');
  });

  it('cookie PRESENT: reused — no new fingerprintId Set-Cookie is emitted', async () => {
    const { token, cookie } = await mintCsrf('/id/login');
    const req = postRequest('/id/login', { csrf: token, loginName: 'alice@acme.test' }, [
      cookie,
      'fingerprintId=already-have-one',
    ]);

    const res = (await loginAction(args(req))) as Response;
    expect(res.status).toBe(302);

    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith('sessions='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('fingerprintId='))).toBe(false);
  });
});
