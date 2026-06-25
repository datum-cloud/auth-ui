// @vitest-environment node
//
// H-1: the webauthn verify route's RE-AUTH identity guard, exercised at the HTTP boundary. Both
// passkey.tsx and security-key.tsx delegate to the shared createWebAuthnVerifyHandlers factory;
// security-key.tsx exports the factory action verbatim, so driving it covers the guard for both.
// verifyWebAuthnAssertion is mocked to a success to isolate the new guard wiring (checkReauthIntent
// → clear cookie → mismatch bounce) from the assertion check.
//
// node env: happy-dom forbids setting the Cookie header, which breaks the CSRF round-trip.
import { getAuthProvider } from '@/modules/auth/select.server';
import { serializeReauthIntent } from '@/modules/auth/session/reauth-intent';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// The factory imports requestWebAuthnChallenge (loader) + verifyWebAuthnAssertion (action) from
// webauthn.service. Mock both; the action only needs verify to succeed so it reaches the guard.
vi.mock('@/resources/webauthn/webauthn.service', () => ({
  requestWebAuthnChallenge: vi.fn(async () => ({
    kind: 'challenge',
    publicKeyCredentialRequestOptions: {},
  })),
  verifyWebAuthnAssertion: vi.fn(async () => ({ ok: true, target: '/signed-in', sessions: [] })),
}));

const { action } = await import('@/routes/login/security-key');

const ORIGIN = 'http://localhost';

async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}/id/login/security-key`));
  return { token, cookie: cookie!.split(';')[0] };
}

function postReq(fields: Record<string, string>, cookies: string[]): Request {
  return new Request(`${ORIGIN}/id/login/security-key`, {
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

describe('login/security-key (webauthn) action — re-auth identity guard (H-1)', () => {
  it('matching identity → completes to the resolved target and clears the intent', async () => {
    getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const { token, cookie } = await mintCsrf();
    const req = postReq({ csrf: token, credential: 'cred', loginName: 'alice@acme.test' }, [
      cookie,
      await reauthCookie('alice@acme.test'),
    ]);

    const res = await runAction(req);
    expect(res.headers.get('location')).toBe('/signed-in');
    expect(res.headers.get('set-cookie')).toContain('reauth-intent=');
  });

  it('different identity → bounces to /accounts?reauthMismatch=1 (carrying requestId), clears intent', async () => {
    getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const { token, cookie } = await mintCsrf();
    const req = postReq(
      { csrf: token, credential: 'cred', loginName: 'bob@acme.test', requestId: 'oidc_x' },
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
    const req = postReq({ csrf: token, credential: 'cred', loginName: 'alice@acme.test' }, [cookie]);

    const res = await runAction(req);
    expect(res.headers.get('location')).toBe('/signed-in');
  });
});
