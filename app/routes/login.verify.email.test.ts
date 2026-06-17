// app/routes/login.verify.email.test.ts
// TDD tests for the OTP-email LINK fix (Bug A):
//   - the loader builds + passes an OTPEmail url_template so the emailed link lands on OUR
//     /id/login/verify/email route (not Zitadel's default /ui/v2/login/otp/email);
//   - arriving via that link (?code present) prefills the form AND suppresses the duplicate
//     challenge re-send (the loader already sent the code when the user first reached this screen).
//
// @vitest-environment node
//
// node env: happy-dom forbids setting the `Cookie` header on a Request.
import { loader, action } from './login.verify.email';
import type { SessionChecks } from '@/providers/auth-provider';
import { FakeAuthProvider } from '@/providers/fake/fake-provider';
import { getAuthProvider } from '@/providers/select.server';
import { sessionsCookie } from '@/session/cookie';
import { describe, it, expect, vi } from 'vitest';

// The action's CSRF check is exercised elsewhere; here we focus on code-length parsing.
vi.mock('@/server/csrf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/csrf')>();
  return { ...actual, assertCsrf: vi.fn(async () => {}) };
});

vi.mock('@/utils/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/env.server')>();
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

describe('login.verify.email loader — OTP-email LINK fix (Bug A)', () => {
  it('requests the otpEmail challenge with an url_template pointing at /id/login/verify/email', async () => {
    const { calls } = await runLoader({});
    expect(calls).toHaveLength(1);
    const challenge = calls[0].challenges?.otpEmail;
    // not bare `true` any more — it carries the template
    expect(challenge).not.toBe(true);
    const urlTemplate = (challenge as { urlTemplate?: string }).urlTemplate;
    expect(urlTemplate).toContain('https://auth.datum.net/id/login/verify/email?');
    expect(urlTemplate).toContain('code={{.Code}}');
    expect(urlTemplate).toContain(`loginName=${encodeURIComponent(LOGIN_NAME)}`);
    // OTPEmail does NOT support {{.OrgID}}
    expect(urlTemplate).not.toContain('{{.OrgID}}');
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

describe('login.verify.email action — 8-digit code (Bug B)', () => {
  async function runAction(code: string) {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    fake.seedLiveSession({ id: 's1', token: 't1', user: { id: 'u1', loginName: LOGIN_NAME } });

    const otpCalls: string[] = [];
    vi.spyOn(fake, 'updateSession').mockImplementation(async (_id, _token, checks) => {
      // Cast targets the VERIFY-path field `SessionChecks.otpEmail: string` (the submitted code
      // we want to capture) — distinct from the CHALLENGE-path `SessionChecks.challenges.otpEmail`
      // (boolean | { urlTemplate?: string }), which lives on the same parent type.
      if (typeof (checks as { otpEmail?: string }).otpEmail === 'string') {
        otpCalls.push((checks as { otpEmail: string }).otpEmail);
      }
      return {
        id: 's1',
        token: 't1',
        user: { id: 'u1', loginName: LOGIN_NAME },
        factors: { otpEmail: { verifiedAt: '2026-01-01T00:00:00.000Z' } },
      } as never;
    });
    vi.spyOn(fake, 'listAuthMethods').mockResolvedValue([]);

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

    const body = new URLSearchParams({ code, loginName: LOGIN_NAME, csrf: 'x' });
    const request = new Request(`http://localhost/id/login/verify/email`, {
      method: 'POST',
      headers: {
        cookie: cookieStr.split(';')[0],
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const response = await action({ request, params: {}, context: {} as never } as never);
    return { response, otpCalls };
  }

  it('accepts an 8-digit code (does not reject as INVALID_INPUT) and forwards it to the provider', async () => {
    const { response, otpCalls } = await runAction('86230120');
    // A 400 INVALID_INPUT comes back as a data() payload; a successful verify is a redirect.
    expect((response as { status?: number }).status).not.toBe(400);
    expect(otpCalls).toContain('86230120');
  });

  it('still accepts a 6-digit code', async () => {
    const { otpCalls } = await runAction('123456');
    expect(otpCalls).toContain('123456');
  });
});
