// cypress/component/modules/auth/providers/fake/fake-provider.mfa.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/fake/__tests__/fake-provider.mfa.test.ts.
import { FakeAuthProvider, FIXED_NOW } from '@/modules/auth/providers/fake/fake-provider';

describe('FakeAuthProvider — MFA (P5)', () => {
  it('registers and verifies TOTP deterministically', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    const reg = await p.registerTotp('u1');
    expect(reg.secret).to.be.ok;
    expect(reg.uri).to.include('u1');
    await p.verifyTotp('u1', '123456'); // fake accepts any code
    expect(await p.listAuthMethods('u1')).to.include('totp');
  });

  it('passkeyRegisterLink → registerPasskey → verifyPasskey enrolls passkey', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    const { code } = await p.passkeyRegisterLink('u1');
    expect(code).to.be.ok;
    await p.registerPasskey('u1', code, 'localhost');
    await p.verifyPasskey('u1', 'pk1', { fake: true });
    expect(await p.listAuthMethods('u1')).to.include('passkey');
  });

  it('registerU2F returns creation options and verifyU2F enrolls u2f', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    const opts = (await p.registerU2F('u1', 'localhost')) as {
      publicKeyCredentialCreationOptions: unknown;
    };
    expect(opts.publicKeyCredentialCreationOptions).to.be.ok;
    await p.verifyU2F('u1', { fake: true });
    expect(await p.listAuthMethods('u1')).to.include('u2f');
  });

  it('addOtpEmail enrolls otp_email (requires email verified first)', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    await p.verifyEmail('u1', 'email-u1');
    await p.addOtpEmail('u1');
    expect(await p.listAuthMethods('u1')).to.include('otp_email');
  });

  it('addOtpSms enrolls otp_sms', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    await p.addOtpSms('u1');
    expect(await p.listAuthMethods('u1')).to.include('otp_sms');
  });

  it('listAuthMethods merges seeded methods and newly-enrolled methods', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      authMethods: { u1: ['password'] },
    });
    await p.verifyEmail('u1', 'email-u1');
    await p.addOtpEmail('u1');
    const methods = await p.listAuthMethods('u1');
    expect(methods).to.include('password');
    expect(methods).to.include('otp_email');
  });

  it('updateSession with a totp check marks the totp factor verified', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { totp: '123456' });
    expect(s2.factors.totp?.verifiedAt).to.not.be.null;
  });

  it('updateSession with a non-empty otpEmail check marks the otpEmail factor verified', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { otpEmail: '654321' });
    expect(s2.factors.otpEmail?.verifiedAt).to.not.be.null;
  });

  it('updateSession with empty otpEmail is a no-op — factor NOT verified, no challenge returned', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { otpEmail: '' });
    expect(s2.factors.otpEmail).to.be.undefined;
    expect(s2.challenges?.otpEmailCode).to.be.undefined;
  });

  it("updateSession with challenges.otpEmail { kind: 'return-code' } requests challenge — factor NOT verified", async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, {
      challenges: { otpEmail: { kind: 'return-code' } },
    });
    expect(s2.factors.otpEmail).to.be.undefined;
    expect(s2.challenges?.otpEmailCode).to.not.be.undefined;
    const stored = await p.getSession(s.id, s.token);
    expect(stored?.challenges?.otpEmailCode).to.be.undefined;
  });

  it('updateSession with a non-empty otpSms check marks the otpSms factor verified', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { otpSms: '111111' });
    expect(s2.factors.otpSms?.verifiedAt).to.not.be.null;
  });

  it('updateSession with empty otpSms is a no-op — factor NOT verified, no challenge returned', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { otpSms: '' });
    expect(s2.factors.otpSms).to.be.undefined;
    expect(s2.challenges?.otpSms).to.be.undefined;
  });

  it('updateSession with challenges.otpSms=true requests challenge — factor NOT verified', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const s2 = await p.updateSession(s.id, s.token, { challenges: { otpSms: true } });
    expect(s2.factors.otpSms).to.be.undefined;
    expect(s2.challenges?.otpSms).to.not.be.undefined;
    const stored = await p.getSession(s.id, s.token);
    expect(stored?.challenges?.otpSms).to.be.undefined;
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
    expect(s2.factors.passkey?.verifiedAt ?? null).to.be.null;
    expect(s2.challenges?.webAuthN?.publicKeyCredentialRequestOptions).to.not.be.undefined;
    const opts = s2.challenges?.webAuthN?.publicKeyCredentialRequestOptions as {
      publicKey?: { challenge?: string };
    };
    expect(opts?.publicKey?.challenge).to.equal('ZmFrZS1jaGFsbGVuZ2U');
    const stored = await p.getSession(s.id, s.token);
    expect(stored?.challenges?.webAuthN).to.be.undefined;
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
    expect(s2.factors.passkey?.verifiedAt).to.not.be.null;
    expect(s2.factors.passkey?.userVerified).to.equal(true);
  });

  it('listSessions returns seeded sessions by id', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    const s = await p.createSession({ password: 'pw' });
    const list = await p.listSessions([s.id]);
    expect(list).to.have.length(1);
    expect(list[0].id).to.equal(s.id);
  });

  it('listSessions returns empty array for unknown ids', async () => {
    const p = new FakeAuthProvider();
    const list = await p.listSessions(['nope-1', 'nope-2']);
    expect(list).to.have.length(0);
  });

  it('setMfaInitSkipped records the skip and surfaces it as mfaInitSkippedAt', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    await p.setMfaInitSkipped('u1');
    const user = await p.getUser('u1');
    expect(user?.mfaInitSkippedAt).to.equal(FIXED_NOW); // deterministic; no Date.now()
    const found = await p.findUser('a@acme.test');
    expect(found?.mfaInitSkippedAt).to.equal(FIXED_NOW);
  });

  it('setMfaInitSkipped is idempotent — repeated calls keep FIXED_NOW', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    await p.setMfaInitSkipped('u1');
    await p.setMfaInitSkipped('u1');
    const user = await p.getUser('u1');
    expect(user?.mfaInitSkippedAt).to.equal(FIXED_NOW);
  });
});

describe('FakeAuthProvider — settingsByOrg (P5)', () => {
  it('getLoginSettings with a seeded org override returns forceMfa true', async () => {
    const p = new FakeAuthProvider({ settingsByOrg: { 'force-org': { forceMfa: true } } });
    const settings = await p.getLoginSettings('force-org');
    expect(settings.forceMfa).to.equal(true);
  });

  it('getLoginSettings with no orgId returns base forceMfa false', async () => {
    const p = new FakeAuthProvider({ settingsByOrg: { 'force-org': { forceMfa: true } } });
    const settings = await p.getLoginSettings();
    expect(settings.forceMfa).to.equal(false);
  });

  it('getLoginSettings for an unseeded org returns base settings unchanged', async () => {
    const p = new FakeAuthProvider({ settingsByOrg: { 'force-org': { forceMfa: true } } });
    const settings = await p.getLoginSettings('other-org');
    expect(settings.forceMfa).to.equal(false);
    expect(settings.allowPassword).to.equal(true);
  });
});
