// @vitest-environment node
//
// H-4: the password route's RE-AUTH identity guard, exercised at the HTTP boundary (real CSRF +
// real reauth-intent cookie, driving the actual route action). verifyLoginPassword is mocked to a
// success so the test isolates the new guard wiring (checkReauthIntent → clear cookie → mismatch
// bounce), not the password check (covered elsewhere).
//
// node env: happy-dom forbids setting the Cookie header, which breaks the CSRF round-trip.
import { getAuthProvider } from '@/modules/auth/select.server';
import { serializeReauthIntent } from '@/modules/auth/session/reauth-intent';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// The route imports ONLY verifyLoginPassword from the '@/resources/login' barrel; mock it to a
// success so the action reaches the re-auth guard. (login.schema / login-view come from sub-paths
// and stay real.)
vi.mock('@/resources/login', () => ({
  verifyLoginPassword: vi.fn(async () => ({ ok: true, target: '/signed-in', sessions: [] })),
}));

const { action } = await import('@/routes/login/password');

const ORIGIN = 'http://localhost';

async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}/id/login/password`));
  return { token, cookie: cookie!.split(';')[0] };
}

function postReq(fields: Record<string, string>, cookies: string[]): Request {
  return new Request(`${ORIGIN}/id/login/password`, {
    method: 'POST',
    headers: { cookie: cookies.join('; '), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

function runAction(req: Request) {
  return action({ request: req, params: {}, context: {} as never } as never) as Promise<Response>;
}

async function reauthCookie(loginName: string) {
  return (await serializeReauthIntent(loginName)).split(';')[0];
}

describe('login/password action — re-auth identity guard (H-4)', () => {
  it('matching identity → completes to the resolved target and clears the intent', async () => {
    getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const { token, cookie } = await mintCsrf();
    const req = postReq({ csrf: token, password: 'pw', loginName: 'alice@acme.test' }, [
      cookie,
      await reauthCookie('alice@acme.test'),
    ]);

    const res = await runAction(req);
    expect(res.headers.get('location')).toBe('/signed-in');
    expect(res.headers.get('set-cookie')).toContain('reauth-intent=');
  });

  it('matches case-insensitively (no false mismatch on casing)', async () => {
    getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const { token, cookie } = await mintCsrf();
    const req = postReq({ csrf: token, password: 'pw', loginName: 'alice@acme.test' }, [
      cookie,
      await reauthCookie('Alice@ACME.test'),
    ]);

    const res = await runAction(req);
    expect(res.headers.get('location')).toBe('/signed-in');
  });

  it('different identity → bounces to /accounts?reauthMismatch=1 (carrying requestId), clears intent', async () => {
    getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const { token, cookie } = await mintCsrf();
    const req = postReq(
      { csrf: token, password: 'pw', loginName: 'bob@acme.test', requestId: 'oidc_x' },
      [cookie, await reauthCookie('alice@acme.test')]
    );

    const res = await runAction(req);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/accounts');
    expect(location).toContain('reauthMismatch=1');
    expect(location).toContain('requestId=oidc_x');
    expect(res.headers.get('set-cookie')).toContain('reauth-intent=');
  });

  it('no re-auth intent → completes normally (no mismatch bounce)', async () => {
    getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const { token, cookie } = await mintCsrf();
    const req = postReq({ csrf: token, password: 'pw', loginName: 'alice@acme.test' }, [cookie]);

    const res = await runAction(req);
    expect(res.headers.get('location')).toBe('/signed-in');
  });
});
