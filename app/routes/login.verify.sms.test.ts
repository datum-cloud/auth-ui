// app/routes/login.verify.sms.test.ts
// TDD test for the OTP-SMS 8-digit code fix (Bug B):
//   SMS one-time codes are 8 digits (same class as email OTP). The action must parse them via
//   otpDeliveryCodeSchema (6–8 digits) instead of the 6-digit otpCodeSchema, otherwise an
//   8-digit code is rejected as INVALID_INPUT (400) before it ever reaches the provider.
//
// @vitest-environment node
//
// node env: happy-dom forbids setting the `Cookie` header on a Request.
import { action } from './login.verify.sms';
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

describe('login.verify.sms action — 8-digit code (Bug B)', () => {
  async function runAction(code: string) {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    fake.seedLiveSession({ id: 's1', token: 't1', user: { id: 'u1', loginName: LOGIN_NAME } });

    const otpCalls: string[] = [];
    vi.spyOn(fake, 'updateSession').mockImplementation(async (_id, _token, checks) => {
      // Cast targets the VERIFY-path field `SessionChecks.otpSms: string` (the submitted code we
      // want to capture) — distinct from the CHALLENGE-path `SessionChecks.challenges.otpSms`
      // (boolean), which lives on the same parent type.
      if (typeof (checks as { otpSms?: string }).otpSms === 'string') {
        otpCalls.push((checks as { otpSms: string }).otpSms);
      }
      return {
        id: 's1',
        token: 't1',
        user: { id: 'u1', loginName: LOGIN_NAME },
        factors: { otpSms: { verifiedAt: '2026-01-01T00:00:00.000Z' } },
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
    const request = new Request(`http://localhost/id/login/verify/sms`, {
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
