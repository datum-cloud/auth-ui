// Factory-level tests for createOtpVerifyHandlers. Drives the factory's loader/action
// with a real FakeAuthProvider + a seeded live session (same harness as the route tests).
// Asserts the per-channel orchestration the factory centralises:
//   - loader guards an active session (→ /login on miss);
//   - email suppresses the duplicate challenge on the ?code link path + prefills the code;
//   - authenticator sends no challenge; email/sms do;
//   - the resend intent redirects back to the verify screen WITHOUT ?code.
// submitOtpCode's verify internals + url_template construction are covered in otp.service.test.ts.
//
// @vitest-environment node
// node env: happy-dom forbids setting the `Cookie` header on a Request.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import { createOtpVerifyHandlers } from '@/resources/otp/otp-verify';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, PUBLIC_ORIGIN: 'https://auth.datum.net', SESSION_SECRET: 'test-secret' },
  };
});

const LOGIN_NAME = 'email-otp-user@acme.test';

const emailHandlers = createOtpVerifyHandlers({
  channel: 'email',
  suppressChallengeOnCode: true,
  nextParamHandling: 'passkey-redirect',
  writeLastUsedLogin: 'email',
  verifyPath: '/login/verify/email',
});
const smsHandlers = createOtpVerifyHandlers({
  channel: 'sms',
  writeLastUsedLogin: false,
  verifyPath: '/login/verify/sms',
});
const authenticatorHandlers = createOtpVerifyHandlers({
  channel: 'authenticator',
  writeLastUsedLogin: false,
  verifyPath: '/login/verify/authenticator',
});

function seededFake() {
  const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
  fake.seedLiveSession({ id: 's1', token: 't1', user: { id: 'u3', loginName: LOGIN_NAME } });
  // updateSession is the seam the email/sms challenge dispatch drives — spy to count sends.
  const calls: unknown[] = [];
  vi.spyOn(fake, 'updateSession').mockImplementation(async () => {
    calls.push(1);
    return {
      id: 's1',
      token: 't1',
      user: { id: 'u3', loginName: LOGIN_NAME },
      factors: {},
    } as never;
  });
  return { fake, calls };
}

async function sessionCookie() {
  const c = await sessionsCookie.serialize([
    {
      id: 's1',
      token: 't1',
      loginName: LOGIN_NAME,
      creationTs: '2026-01-01T00:00:00.000Z',
      expirationTs: '2099-01-01T00:00:00.000Z',
      changeTs: '2026-01-01T00:00:00.000Z',
    },
  ]);
  return c.split(';')[0];
}

function loaderArgs(url: string, cookie?: string) {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  return { request: new Request(url, { headers }), params: {}, context: {} as never } as never;
}

describe('createOtpVerifyHandlers — loader session guard', () => {
  it('redirects to /login when there is no active session (no cookie)', async () => {
    seededFake();
    const res = (await emailHandlers.loader(
      loaderArgs(`http://localhost/id/login/verify/email?loginName=${LOGIN_NAME}`)
    )) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });
});

describe('createOtpVerifyHandlers — loader challenge dispatch matrix', () => {
  it('email: sends the challenge once on first arrival (no ?code)', async () => {
    const { calls } = seededFake();
    await emailHandlers.loader(
      loaderArgs(
        `http://localhost/id/login/verify/email?loginName=${LOGIN_NAME}`,
        await sessionCookie()
      )
    );
    expect(calls).toHaveLength(1);
  });

  it('email: suppresses the duplicate challenge AND prefills code on the ?code link path', async () => {
    const { calls } = seededFake();
    const res = (await emailHandlers.loader(
      loaderArgs(
        `http://localhost/id/login/verify/email?loginName=${LOGIN_NAME}&code=86230120`,
        await sessionCookie()
      )
    )) as unknown as { data: { code: string } };
    expect(calls).toHaveLength(0);
    expect(res.data.code).toBe('86230120');
  });

  it('authenticator: sends no challenge (user reads the code from their app)', async () => {
    const { calls } = seededFake();
    await authenticatorHandlers.loader(
      loaderArgs(
        `http://localhost/id/login/verify/authenticator?loginName=${LOGIN_NAME}`,
        await sessionCookie()
      )
    );
    expect(calls).toHaveLength(0);
  });

  it('sms: sends a challenge on arrival', async () => {
    const { calls } = seededFake();
    await smsHandlers.loader(
      loaderArgs(
        `http://localhost/id/login/verify/sms?loginName=${LOGIN_NAME}`,
        await sessionCookie()
      )
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('createOtpVerifyHandlers — resend intent', () => {
  it('redirects back to the verify path without ?code', async () => {
    seededFake();
    const [token, csrfCookie] = await getCsrfToken(
      new Request('http://localhost/id/login/verify/email')
    );
    const body = new URLSearchParams({ csrf: token, intent: 'resend', loginName: LOGIN_NAME });
    const res = (await emailHandlers.action({
      request: new Request('http://localhost/id/login/verify/email', {
        method: 'POST',
        headers: {
          cookie: (csrfCookie as string).split(';')[0],
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }),
      params: {},
      context: {} as never,
    } as never)) as Response;
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc.startsWith('/login/verify/email?')).toBe(true);
    expect(loc).toContain(`loginName=${encodeURIComponent(LOGIN_NAME)}`);
    expect(loc).not.toContain('code=');
  });
});
