// app/routes/login/verify/__tests__/email.test.ts
// Thin ROUTE-level loader test for the OTP-email LINK fix (Bug A): the loader-side
// query gating that stays in the route after the Pass 2 extraction —
//   - arriving WITHOUT ?code (typed-in path) sends the challenge once and returns code: '';
//   - arriving WITH ?code (emailed link) prefills the form AND suppresses the duplicate
//     challenge re-send (the loader already sent the code on first arrival; re-sending would
//     rotate/invalidate the held code).
// The url_template CONSTRUCTION + the action's code-length parsing are asserted at the
// service boundary in app/resources/otp/__tests__/otp.service.test.ts.
//
// @vitest-environment node
//
// node env: happy-dom forbids setting the `Cookie` header on a Request.
import type { SessionChecks } from '@/modules/auth/auth-provider';
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import { loader } from '@/routes/login/verify/email';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/env/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/env/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, PUBLIC_ORIGIN: 'https://auth.datum.net', SESSION_SECRET: 'test-secret' },
  };
});

const LOGIN_NAME = 'alice@acme.test';
const BASE = `http://localhost/id/login/verify/email?loginName=${encodeURIComponent(LOGIN_NAME)}`;

interface RunOpts {
  url?: string;
}

async function runLoader({ url = BASE }: RunOpts) {
  const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;

  fake.seedLiveSession({
    id: 's1',
    token: 't1',
    user: { id: 'u1', loginName: LOGIN_NAME },
  });

  const calls: SessionChecks[] = [];
  vi.spyOn(fake, 'updateSession').mockImplementation(async (_id, _token, checks) => {
    calls.push(checks);
    return {
      id: 's1',
      token: 't1',
      user: { id: 'u1', loginName: LOGIN_NAME },
      factors: {},
    } as never;
  });

  const cookieStr = await sessionsCookie.serialize([
    {
      id: 's1',
      token: 't1',
      loginName: LOGIN_NAME,
      creationTs: '2026-01-01T00:00:00.000Z',
      expirationTs: '2099-01-01T00:00:00.000Z',
      changeTs: '2026-01-01T00:00:00.000Z',
    },
  ]);

  const request = new Request(url, { headers: { cookie: cookieStr.split(';')[0] } });
  const response = await loader({ request, params: {}, context: {} as never } as never);
  return { calls, response };
}

describe('login.verify.email loader — OTP-email LINK fix (Bug A) route gating', () => {
  it('sends the otpEmail challenge once on first arrival (typed-in path, no ?code)', async () => {
    const { calls } = await runLoader({});
    expect(calls).toHaveLength(1);
  });

  it('returns an empty code when arriving WITHOUT a ?code (typed-in path)', async () => {
    const { response } = await runLoader({});
    // React Router's data() wraps the value in DataWithResponseInit; the payload is on .data.
    const body = (response as unknown as { data: { code: string } }).data;
    expect(body.code).toBe('');
  });

  it('prefills the code from ?code when arriving via the emailed link', async () => {
    const { response } = await runLoader({ url: `${BASE}&code=86230120` });
    const body = (response as unknown as { data: { code: string } }).data;
    expect(body.code).toBe('86230120');
  });

  it('suppresses the duplicate challenge re-send when arriving via the link (?code present)', async () => {
    // The code was already mailed when the user first reached this screen; re-sending on the
    // link click would rotate/invalidate the code the user is holding. So no updateSession.
    const { calls } = await runLoader({ url: `${BASE}&code=86230120` });
    expect(calls).toHaveLength(0);
  });
});
