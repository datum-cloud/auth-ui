// app/resources/verify/__tests__/verify.service.test.ts
// @vitest-environment node
//
// Pass 2 service tests for the verify domain. These port the behavioral assertions
// from the former route test (routes/verify/__tests__/verify.test.ts) down to the
// service boundary, calling dispatchEmailCode directly against the fake provider
// singleton. The route resolves the active session from the SIGNED cookie and hands
// it to the service; here we pass the resolved {id, token} in directly (no HTTP/cookie
// ceremony), which is exactly what the route does after readSessions → mostRecent.
//
// The loader previously sent an email code for ANY userId on an
// unauthenticated GET — a code-flood / enumeration vector. The fix gates the send on
// an active session whose provider-resolved user matches the userId query param.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { ProviderError } from '@/modules/auth/types';
import { dispatchEmailCode, resendEmailCode, submitEmailCode } from '@/resources/verify';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TRUSTED_ORIGIN = 'https://auth.datum.net';

function fakeProvider(): FakeAuthProvider {
  return getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
}

describe('dispatchEmailCode — session-ownership gate on ?send=true', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not send an email code when the session user does not match the userId query', async () => {
    const fake = fakeProvider();
    // Seed a live session whose user.id is the attacker, NOT the victim being targeted.
    fake.seedLiveSession({
      id: 's1',
      token: 't1',
      user: { id: 'attacker-1', loginName: 'test@example.com' },
    });
    let sent = 0;
    vi.spyOn(fake, 'sendEmailCode').mockImplementation(() => {
      sent++;
      return Promise.resolve();
    });

    await dispatchEmailCode(fake, {
      userId: 'victim-999',
      origin: TRUSTED_ORIGIN,
      invite: false,
      session: { id: 's1', token: 't1' },
    });

    expect(sent).toBe(0);
  });

  it('sends an email code when the session user matches the userId query', async () => {
    const fake = fakeProvider();
    fake.seedLiveSession({
      id: 's1',
      token: 't1',
      user: { id: 'self-1', loginName: 'test@example.com' },
    });
    let sent = 0;
    vi.spyOn(fake, 'sendEmailCode').mockImplementation(() => {
      sent++;
      return Promise.resolve();
    });

    await dispatchEmailCode(fake, {
      userId: 'self-1',
      origin: TRUSTED_ORIGIN,
      invite: false,
      session: { id: 's1', token: 't1' },
    });

    expect(sent).toBe(1);
  });

  it('does not send when there is no active session (fail closed)', async () => {
    const fake = fakeProvider();
    let sent = 0;
    vi.spyOn(fake, 'sendEmailCode').mockImplementation(() => {
      sent++;
      return Promise.resolve();
    });

    await dispatchEmailCode(fake, {
      userId: 'self-1',
      origin: TRUSTED_ORIGIN,
      invite: false,
      session: undefined,
    });

    expect(sent).toBe(0);
  });

  it('builds the verify link from the trusted origin with raw braces (no percent-encoding)', async () => {
    const fake = fakeProvider();
    fake.seedLiveSession({
      id: 's1',
      token: 't1',
      user: { id: 'self-1', loginName: 'test@example.com' },
    });
    const spy = vi.spyOn(fake, 'sendEmailCode').mockResolvedValue();

    await dispatchEmailCode(fake, {
      userId: 'self-1',
      origin: TRUSTED_ORIGIN,
      requestId: 'oidc_42',
      invite: false,
      session: { id: 's1', token: 't1' },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [userId, urlTemplate] = spy.mock.calls[0];
    expect(userId).toBe('self-1');
    expect(urlTemplate.startsWith('https://auth.datum.net/id/verify?')).toBe(true);
    expect(urlTemplate).toContain('code={{.Code}}');
    expect(urlTemplate).not.toContain('%7B');
    expect(urlTemplate).toContain('&requestId=oidc_42');
  });

  it('uses resendEmailCode (not sendEmailCode) for invite codes', async () => {
    const fake = fakeProvider();
    fake.seedLiveSession({
      id: 's1',
      token: 't1',
      user: { id: 'self-1', loginName: 'test@example.com' },
    });
    const send = vi.spyOn(fake, 'sendEmailCode').mockResolvedValue();
    const resend = vi.spyOn(fake, 'resendEmailCode').mockResolvedValue();

    await dispatchEmailCode(fake, {
      userId: 'self-1',
      origin: TRUSTED_ORIGIN,
      invite: true,
      session: { id: 's1', token: 't1' },
    });

    expect(send).not.toHaveBeenCalled();
    expect(resend).toHaveBeenCalledTimes(1);
  });

  it('swallows ALREADY_DONE from the provider (already verified) without throwing', async () => {
    const fake = fakeProvider();
    fake.seedLiveSession({
      id: 's1',
      token: 't1',
      user: { id: 'self-1', loginName: 'test@example.com' },
    });
    vi.spyOn(fake, 'sendEmailCode').mockRejectedValue(
      new ProviderError('ALREADY_DONE', 'already verified')
    );

    await expect(
      dispatchEmailCode(fake, {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
        session: { id: 's1', token: 't1' },
      })
    ).resolves.toBeUndefined();
  });

  it('re-throws non-ALREADY_DONE provider errors', async () => {
    const fake = fakeProvider();
    fake.seedLiveSession({
      id: 's1',
      token: 't1',
      user: { id: 'self-1', loginName: 'test@example.com' },
    });
    vi.spyOn(fake, 'sendEmailCode').mockRejectedValue(new ProviderError('UNKNOWN', 'boom'));

    await expect(
      dispatchEmailCode(fake, {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
        session: { id: 's1', token: 't1' },
      })
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('does not send when getSession fails (fail closed)', async () => {
    const fake = fakeProvider();
    vi.spyOn(fake, 'getSession').mockRejectedValue(new Error('getSession blew up'));
    let sent = 0;
    vi.spyOn(fake, 'sendEmailCode').mockImplementation(() => {
      sent++;
      return Promise.resolve();
    });

    await dispatchEmailCode(fake, {
      userId: 'self-1',
      origin: TRUSTED_ORIGIN,
      invite: false,
      session: { id: 's1', token: 't1' },
    });

    expect(sent).toBe(0);
  });
});

describe('resendEmailCode — action intent=resend', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns CODE_SENT on a successful resend', async () => {
    const fake = fakeProvider();
    const spy = vi.spyOn(fake, 'resendEmailCode').mockResolvedValue();

    const result = await resendEmailCode(fake, {
      userId: 'self-1',
      origin: TRUSTED_ORIGIN,
      invite: false,
    });

    expect(result).toEqual({ ok: true, notice: 'CODE_SENT' });
    expect(spy).toHaveBeenCalledTimes(1);
    const [, urlTemplate] = spy.mock.calls[0];
    expect(urlTemplate.startsWith('https://auth.datum.net/id/verify?')).toBe(true);
    expect(urlTemplate).toContain('code={{.Code}}');
    expect(urlTemplate).not.toContain('%7B');
  });

  it('returns ALREADY_VERIFIED when the provider reports ALREADY_DONE', async () => {
    const fake = fakeProvider();
    vi.spyOn(fake, 'resendEmailCode').mockRejectedValue(
      new ProviderError('ALREADY_DONE', 'already verified')
    );

    const result = await resendEmailCode(fake, {
      userId: 'self-1',
      origin: TRUSTED_ORIGIN,
      invite: false,
    });

    expect(result).toEqual({ ok: true, notice: 'ALREADY_VERIFIED' });
  });

  it('re-throws non-ALREADY_DONE provider errors', async () => {
    const fake = fakeProvider();
    vi.spyOn(fake, 'resendEmailCode').mockRejectedValue(new ProviderError('UNKNOWN', 'boom'));

    await expect(
      resendEmailCode(fake, { userId: 'self-1', origin: TRUSTED_ORIGIN, invite: false })
    ).rejects.toBeInstanceOf(ProviderError);
  });

  // Input gate (restores the original action's verifyCodeSchema gate, which ran BEFORE
  // the intent branch and so covered the resend path too: userId.min(1)). A
  // malformed/forged resend with an empty userId is rejected as INVALID_INPUT and never
  // reaches the provider.
  it('returns INVALID_INPUT and never calls the provider when userId is empty', async () => {
    const fake = fakeProvider();
    const spy = vi.spyOn(fake, 'resendEmailCode').mockResolvedValue();

    const result = await resendEmailCode(fake, {
      userId: '',
      origin: TRUSTED_ORIGIN,
      invite: false,
    });

    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('submitEmailCode — action default verify intent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function form(overrides: Record<string, string> = {}): Record<string, unknown> {
    return { userId: 'self-1', code: '123456', ...overrides };
  }

  it('returns INVALID_INPUT when the form fails schema validation', async () => {
    const fake = fakeProvider();
    // missing code → verifyCodeSchema requires code.min(1)
    const result = await submitEmailCode(fake, { userId: 'self-1' }, false);
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('verifies the email and redirects to /authorize when an active session + requestId are present', async () => {
    const fake = fakeProvider();
    const verifyEmail = vi.spyOn(fake, 'verifyEmail').mockResolvedValue();

    const result = await submitEmailCode(fake, form({ requestId: 'oidc_99' }), true);

    expect(verifyEmail).toHaveBeenCalledWith('self-1', '123456');
    expect(result).toEqual({ ok: true, target: '/authorize?requestId=oidc_99' });
  });

  it('redirects to /signed-in when an active session is present without a requestId', async () => {
    const fake = fakeProvider();
    vi.spyOn(fake, 'verifyEmail').mockResolvedValue();

    const result = await submitEmailCode(fake, form(), true);

    expect(result).toEqual({ ok: true, target: '/signed-in' });
  });

  it('redirects to /verify/success carrying loginName/requestId/organization when no active session', async () => {
    const fake = fakeProvider();
    vi.spyOn(fake, 'verifyEmail').mockResolvedValue();

    const result = await submitEmailCode(
      fake,
      form({ loginName: 'alice@acme.test', requestId: 'oidc_7', organization: 'org-1' }),
      false
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.startsWith('/verify/success?')).toBe(true);
      expect(result.target).toContain('loginName=alice%40acme.test');
      expect(result.target).toContain('requestId=oidc_7');
      expect(result.target).toContain('organization=org-1');
    }
  });

  it('uses verifyInvite (not verifyEmail) for invite flows', async () => {
    const fake = fakeProvider();
    const verifyInvite = vi.spyOn(fake, 'verifyInvite').mockResolvedValue();
    const verifyEmail = vi.spyOn(fake, 'verifyEmail').mockResolvedValue();

    await submitEmailCode(fake, form({ invite: 'true' }), false);

    expect(verifyInvite).toHaveBeenCalledWith('self-1', '123456');
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it('maps provider INVALID_CREDENTIALS (bad/expired code) to a typed error', async () => {
    const fake = fakeProvider();
    vi.spyOn(fake, 'verifyEmail').mockRejectedValue(
      new ProviderError('INVALID_CREDENTIALS', 'bad code')
    );

    const result = await submitEmailCode(fake, form(), false);

    expect(result).toEqual({ ok: false, error: 'INVALID_CREDENTIALS' });
  });

  it('re-throws non-mapped provider errors', async () => {
    const fake = fakeProvider();
    vi.spyOn(fake, 'verifyEmail').mockRejectedValue(new ProviderError('UNKNOWN', 'boom'));

    await expect(submitEmailCode(fake, form(), false)).rejects.toBeInstanceOf(ProviderError);
  });
});
