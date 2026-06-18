import { FakeAuthProvider, FIXED_NOW } from './fake-provider';
import { describe, it, expect } from 'vitest';

describe('FakeAuthProvider — MFA (P5)', () => {
  it('registers and verifies TOTP deterministically', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    const reg = await p.registerTotp('u1');
    expect(reg.secret).toBeTruthy();
    expect(reg.uri).toContain('u1');
    await p.verifyTotp('u1', '123456'); // fake accepts any code
    expect(await p.listAuthMethods('u1')).toContain('totp');
  });

  it('passkeyRegisterLink → registerPasskey → verifyPasskey enrolls passkey', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    const { code } = await p.passkeyRegisterLink('u1');
    expect(code).toBeTruthy();
    await p.registerPasskey('u1', code, 'localhost');
    await p.verifyPasskey('u1', 'pk1', { fake: true });
    expect(await p.listAuthMethods('u1')).toContain('passkey');
  });

  it('registerU2F returns creation options and verifyU2F enrolls u2f', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    const opts = (await p.registerU2F('u1', 'localhost')) as {
      publicKeyCredentialCreationOptions: unknown;
    };
    expect(opts.publicKeyCredentialCreationOptions).toBeTruthy();
    await p.verifyU2F('u1', { fake: true });
    expect(await p.listAuthMethods('u1')).toContain('u2f');
  });

  it('addOtpEmail enrolls otp_email (requires email verified first)', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    // Seeded users have their email code set as `email-<id>` by the constructor
    await p.verifyEmail('u1', 'email-u1');
    await p.addOtpEmail('u1');
    expect(await p.listAuthMethods('u1')).toContain('otp_email');
  });

  it('addOtpSms enrolls otp_sms', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    await p.addOtpSms('u1');
    expect(await p.listAuthMethods('u1')).toContain('otp_sms');
  });

  it('listAuthMethods merges seeded methods and newly-enrolled methods', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      authMethods: { u1: ['password'] },
    });
    // Seeded users have their email code set as `email-<id>` by the constructor
    await p.verifyEmail('u1', 'email-u1');
    await p.addOtpEmail('u1');
    const methods = await p.listAuthMethods('u1');
    expect(methods).toContain('password');
    expect(methods).toContain('otp_email');
  });

  it('updateSession with a totp check marks the totp factor verified', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { totp: '123456' });
    expect(s2.factors.totp?.verifiedAt).not.toBeNull();
  });

  it('updateSession with a non-empty otpEmail check marks the otpEmail factor verified', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { otpEmail: '654321' });
    expect(s2.factors.otpEmail?.verifiedAt).not.toBeNull();
  });

  it('updateSession with empty otpEmail is a no-op — factor NOT verified, no challenge returned', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { otpEmail: '' });
    // Empty string is no-op — factor must NOT be verified
    expect(s2.factors.otpEmail).toBeUndefined();
    // No challenge returned for empty string (use checks.challenges.otpEmail instead)
    expect(s2.challenges?.otpEmail).toBeUndefined();
  });

  it('updateSession with challenges.otpEmail=true requests challenge — factor NOT verified', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { challenges: { otpEmail: true } });
    // Factor must NOT be verified
    expect(s2.factors.otpEmail).toBeUndefined();
    // Challenge must be present on the returned session
    expect(s2.challenges?.otpEmail).toBeDefined();
    // Stored session must not have a stale challenge (challenges ride only on the returned copy)
    const stored = await p.getSession(s.id, s.token);
    expect(stored?.challenges?.otpEmail).toBeUndefined();
  });

  it('updateSession with a non-empty otpSms check marks the otpSms factor verified', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { otpSms: '111111' });
    expect(s2.factors.otpSms?.verifiedAt).not.toBeNull();
  });

  it('updateSession with empty otpSms is a no-op — factor NOT verified, no challenge returned', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { otpSms: '' });
    // Empty string is no-op — factor must NOT be verified
    expect(s2.factors.otpSms).toBeUndefined();
    // No challenge returned for empty string (use checks.challenges.otpSms instead)
    expect(s2.challenges?.otpSms).toBeUndefined();
  });

  it('updateSession with challenges.otpSms=true requests challenge — factor NOT verified', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { challenges: { otpSms: true } });
    // Factor must NOT be verified
    expect(s2.factors.otpSms).toBeUndefined();
    // Challenge must be present on the returned session
    expect(s2.challenges?.otpSms).toBeDefined();
    // Stored session must not have a stale challenge (challenges ride only on the returned copy)
    const stored = await p.getSession(s.id, s.token);
    expect(stored?.challenges?.otpSms).toBeUndefined();
  });

  it('updateSession with challenges.webAuthN returns deterministic pre-baked assertion challenge', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, {
      challenges: { webAuthN: { domain: 'localhost', userVerificationRequirement: 'required' } },
    });
    // Factor must NOT be verified (this is a challenge request, not a verification)
    expect(s2.factors.passkey?.verifiedAt ?? null).toBeNull();
    // Challenge must be present
    expect(s2.challenges?.webAuthN?.publicKeyCredentialRequestOptions).toBeDefined();
    const opts = s2.challenges?.webAuthN?.publicKeyCredentialRequestOptions as {
      publicKey?: { challenge?: string };
    };
    expect(opts?.publicKey?.challenge).toBe('ZmFrZS1jaGFsbGVuZ2U');
    // Stored session must not have the challenge
    const stored = await p.getSession(s.id, s.token);
    expect(stored?.challenges?.webAuthN).toBeUndefined();
  });

  it('updateSession with a webAuthN check marks passkey factor verified with userVerified=true', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, {
      webAuthN: { credentialAssertionData: { fake: true } },
    });
    expect(s2.factors.passkey?.verifiedAt).not.toBeNull();
    expect(s2.factors.passkey?.userVerified).toBe(true);
  });

  it('listSessions returns seeded sessions by id', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    const s = await p.createSession({ password: 'pw' });
    const list = await p.listSessions([s.id]);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(s.id);
  });

  it('listSessions returns empty array for unknown ids', async () => {
    const p = new FakeAuthProvider();
    const list = await p.listSessions(['nope-1', 'nope-2']);
    expect(list).toHaveLength(0);
  });

  it('setMfaInitSkipped records the skip and surfaces it as mfaInitSkippedAt (BLK-06)', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    await p.setMfaInitSkipped('u1');
    const user = await p.getUser('u1');
    expect(user?.mfaInitSkippedAt).toBe(FIXED_NOW); // deterministic; no Date.now()
    // and the read-by-loginName path agrees
    const found = await p.findUser('a@acme.test');
    expect(found?.mfaInitSkippedAt).toBe(FIXED_NOW);
  });

  it('setMfaInitSkipped is idempotent — repeated calls keep FIXED_NOW', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    await p.setMfaInitSkipped('u1');
    await p.setMfaInitSkipped('u1');
    const user = await p.getUser('u1');
    expect(user?.mfaInitSkippedAt).toBe(FIXED_NOW);
  });
});

describe('FakeAuthProvider — settingsByOrg (P5)', () => {
  it('getLoginSettings with a seeded org override returns forceMfa true', async () => {
    const p = new FakeAuthProvider({
      settingsByOrg: { 'force-org': { forceMfa: true } },
    });
    const settings = await p.getLoginSettings('force-org');
    expect(settings.forceMfa).toBe(true);
  });

  it('getLoginSettings with no orgId returns base forceMfa false', async () => {
    const p = new FakeAuthProvider({
      settingsByOrg: { 'force-org': { forceMfa: true } },
    });
    const settings = await p.getLoginSettings();
    expect(settings.forceMfa).toBe(false);
  });

  it('getLoginSettings for an unseeded org returns base settings unchanged', async () => {
    const p = new FakeAuthProvider({
      settingsByOrg: { 'force-org': { forceMfa: true } },
    });
    const settings = await p.getLoginSettings('other-org');
    expect(settings.forceMfa).toBe(false);
    expect(settings.allowPassword).toBe(true);
  });
});
