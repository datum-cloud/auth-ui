// app/resources/otp/__tests__/otp.service.test.ts
// Pass 2 service tests for the OTP domain. These port the behavioral assertions that
// previously lived in routes/login/verify/__tests__/{email,sms}.test.ts down to the
// service boundary (submitOtpCode / dispatchEmailChallenge), driving the fake provider
// exactly as the route tests did.
//
// @vitest-environment node
import type { SessionChecks } from '@/modules/auth/auth-provider';
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { dispatchEmailChallenge, submitOtpCode, type OtpSessionEntry } from '@/resources/otp';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/env/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/env/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, PUBLIC_ORIGIN: 'https://auth.datum.net', SESSION_SECRET: 'test-secret' },
  };
});

const LOGIN_NAME = 'alice@acme.test';
const ORIGIN = 'https://auth.datum.net';

const ENTRY: OtpSessionEntry = {
  id: 's1',
  token: 't1',
  loginName: LOGIN_NAME,
  creationTs: '2026-01-01T00:00:00.000Z',
  expirationTs: '2099-01-01T00:00:00.000Z',
  changeTs: '2026-01-01T00:00:00.000Z',
};

// ── dispatchEmailChallenge — OTP-email LINK fix (Bug A) ────────────────────────

describe('dispatchEmailChallenge — OTP-email LINK fix (Bug A)', () => {
  function seedFake() {
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
    return { fake, calls };
  }

  it('requests the otpEmail challenge with an url_template pointing at /id/login/verify/email', async () => {
    const { fake, calls } = seedFake();
    await dispatchEmailChallenge(fake, ENTRY, { origin: ORIGIN, loginName: LOGIN_NAME });

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
});

// ── submitOtpCode — email channel, 8-digit code (Bug B) ───────────────────────

describe('submitOtpCode email — 8-digit code (Bug B)', () => {
  async function runVerify(code: string) {
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

    const result = await submitOtpCode(
      fake,
      'email',
      { code, loginName: LOGIN_NAME, csrf: 'x' },
      ENTRY
    );
    return { result, otpCalls };
  }

  it('accepts an 8-digit code (does not reject as INVALID_INPUT) and forwards it to the provider', async () => {
    const { result, otpCalls } = await runVerify('86230120');
    // INVALID_INPUT would be a failed result; a successful verify returns a redirect target.
    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.target).toBe('string');
    expect(otpCalls).toContain('86230120');
  });

  it('still accepts a 6-digit code', async () => {
    const { otpCalls } = await runVerify('123456');
    expect(otpCalls).toContain('123456');
  });
});

// ── submitOtpCode — sms channel, 8-digit code (Bug B) ─────────────────────────

describe('submitOtpCode sms — 8-digit code (Bug B)', () => {
  async function runVerify(code: string) {
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

    const result = await submitOtpCode(
      fake,
      'sms',
      { code, loginName: LOGIN_NAME, csrf: 'x' },
      ENTRY
    );
    return { result, otpCalls };
  }

  it('accepts an 8-digit code (does not reject as INVALID_INPUT) and forwards it to the provider', async () => {
    const { result, otpCalls } = await runVerify('86230120');
    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.target).toBe('string');
    expect(otpCalls).toContain('86230120');
  });

  it('still accepts a 6-digit code', async () => {
    const { otpCalls } = await runVerify('123456');
    expect(otpCalls).toContain('123456');
  });
});
