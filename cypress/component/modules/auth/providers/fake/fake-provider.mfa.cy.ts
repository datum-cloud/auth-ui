// cypress/component/modules/auth/providers/fake/fake-provider.mfa.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/fake/__tests__/fake-provider.mfa.test.ts.
//
// NOTE: this exercises a FAKE provider (test double / harness), not production security logic.
// Coverage is consolidated to one representative test per distinct capability. otpEmail's
// precondition-gate + challenge + verify + wrong-code behavior is the dedicated subject of
// fake-otpemail.cy.ts and is not re-verified here to avoid duplicate coverage of the same code path.
import { FakeAuthProvider, FIXED_NOW } from '@/modules/auth/providers/fake/fake-provider';
import { PREBAKED_CREDENTIAL_ID } from '@/modules/auth/providers/fake/fake-webauthn';

describe('FakeAuthProvider — MFA (P5)', () => {
  it('enrolls totp, passkey, and otp_email methods; listAuthMethods merges seeded + newly-enrolled methods', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      authMethods: { u1: ['password'] },
    });

    const reg = await p.registerTotp('u1');
    expect(reg.secret).to.be.ok;
    expect(reg.uri).to.include('u1');
    await p.verifyTotp('u1', '123456'); // fake accepts any code

    const { code } = await p.passkeyRegisterLink('u1');
    expect(code).to.be.ok;
    await p.registerPasskey('u1', code, 'localhost');
    await p.verifyPasskey('u1', 'pk1', { id: PREBAKED_CREDENTIAL_ID });

    await p.verifyEmail('u1', 'email-u1');
    await p.addOtpEmail('u1');

    const methods = await p.listAuthMethods('u1');
    expect(methods).to.include('password');
    expect(methods).to.include('totp');
    expect(methods).to.include('passkey');
    expect(methods).to.include('otp_email');
  });

  it('updateSession verifies totp/otpSms/webAuthN factors independently, treats an empty otpSms code as a no-op, and issues a real WebAuthn challenge on request', async () => {
    const seed = {
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    };

    // Verifying multiple independent factors in a single updateSession call.
    const p1 = new FakeAuthProvider(seed);
    const s1 = await p1.createSession({ password: 'pw' }, { userId: 'u1' });
    const verified = await p1.updateSession(s1.id, s1.token, {
      totp: '123456',
      otpSms: '111111',
      webAuthN: { credentialAssertionData: { id: PREBAKED_CREDENTIAL_ID } },
    });
    expect(verified.factors.totp?.verifiedAt).to.not.be.null;
    expect(verified.factors.otpSms?.verifiedAt).to.not.be.null;
    expect(verified.factors.passkey?.verifiedAt).to.not.be.null;
    expect(verified.factors.passkey?.userVerified).to.equal(true);

    // Empty otpSms is a no-op — the factor stays unverified.
    const p2 = new FakeAuthProvider(seed);
    const s2 = await p2.createSession({ password: 'pw' }, { userId: 'u1' });
    const noop = await p2.updateSession(s2.id, s2.token, { otpSms: '' });
    expect(noop.factors.otpSms).to.be.undefined;

    // Challenge requests ride back on the response only — never persisted on the stored session.
    const challenged = await p2.updateSession(s2.id, s2.token, {
      challenges: {
        otpSms: true,
        webAuthN: { domain: 'localhost', userVerificationRequirement: 'required' },
      },
    });
    expect(challenged.factors.otpSms).to.be.undefined;
    expect(challenged.challenges?.otpSms).to.not.be.undefined;
    const opts = challenged.challenges?.webAuthN?.publicKeyCredentialRequestOptions as {
      publicKey?: { challenge?: string };
    };
    expect(opts?.publicKey?.challenge).to.match(/^[A-Za-z0-9_-]{16,}$/);
    const stored = await p2.getSession(s2.id, s2.token);
    expect(stored?.challenges?.otpSms).to.be.undefined;
    expect(stored?.challenges?.webAuthN).to.be.undefined;
  });

  it('updateSession records a non-verified webAuthN check as u2f and leaves passkey unset', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    (
      p as unknown as { webauthn: { verifyAssertion: () => Promise<{ userVerified: boolean }> } }
    ).webauthn.verifyAssertion = async () => ({ userVerified: false });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const out = await p.updateSession(s.id, s.token, {
      webAuthN: { credentialAssertionData: { id: 'real-key' } },
    });
    expect(out.factors.u2f?.verifiedAt).to.be.instanceOf(Date);
    expect(out.factors.u2f?.userVerified).to.equal(false);
    expect(out.factors.passkey?.verifiedAt ?? null).to.be.null;
  });

  it('updateSession records a user-verified webAuthN check as passkey and leaves u2f unset', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const out = await p.updateSession(s.id, s.token, {
      webAuthN: { credentialAssertionData: { id: PREBAKED_CREDENTIAL_ID } },
    });
    expect(out.factors.passkey?.verifiedAt).to.be.instanceOf(Date);
    expect(out.factors.passkey?.userVerified).to.equal(true);
    expect(out.factors.u2f?.verifiedAt ?? null).to.be.null;
  });

  it('a later non-verified webAuthN check clears the passkey factor and sets u2f', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      passwords: { u1: 'pw' },
    });
    const s = await p.createSession({ password: 'pw' }, { userId: 'u1' });
    const first = await p.updateSession(s.id, s.token, {
      webAuthN: { credentialAssertionData: { id: PREBAKED_CREDENTIAL_ID } },
    });
    expect(first.factors.passkey?.verifiedAt).to.be.instanceOf(Date);
    (
      p as unknown as { webauthn: { verifyAssertion: () => Promise<{ userVerified: boolean }> } }
    ).webauthn.verifyAssertion = async () => ({ userVerified: false });
    const second = await p.updateSession(s.id, s.token, {
      webAuthN: { credentialAssertionData: { id: 'real-key' } },
    });
    expect(second.factors.passkey?.verifiedAt).to.be.null;
    expect(second.factors.passkey?.userVerified).to.equal(false);
    expect(second.factors.u2f?.verifiedAt).to.be.instanceOf(Date);
  });

  it('listSessions returns seeded sessions by id and an empty array for unknown ids; setMfaInitSkipped records the skip deterministically (FIXED_NOW) and is idempotent; getLoginSettings honors a per-org forceMfa override and falls back to base settings otherwise', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@acme.test' }],
      settingsByOrg: { 'force-org': { forceMfa: true } },
    });
    const s = await p.createSession({ password: 'pw' });
    expect(await p.listSessions([s.id])).to.have.length(1);
    expect(await p.listSessions(['nope-1', 'nope-2'])).to.have.length(0);

    await p.setMfaInitSkipped('u1');
    await p.setMfaInitSkipped('u1');
    const user = await p.getUser('u1');
    expect(user?.mfaInitSkippedAt).to.equal(FIXED_NOW); // deterministic; no Date.now()
    const found = await p.findUser('a@acme.test');
    expect(found?.mfaInitSkippedAt).to.equal(FIXED_NOW);

    expect((await p.getLoginSettings('force-org')).forceMfa).to.equal(true);
    expect((await p.getLoginSettings()).forceMfa).to.equal(false);
    const other = await p.getLoginSettings('other-org');
    expect(other.forceMfa).to.equal(false);
    expect(other.allowPassword).to.equal(true);
  });

  it('registerU2F options carry rp.id equal to the domain and a challenge', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    const reg = await p.registerU2F('u1', 'auth.example.test');
    const publicKey = (
      reg.publicKeyCredentialCreationOptions as {
        publicKey: { rp: { id: string }; challenge: string };
      }
    ).publicKey;
    expect(reg.u2fId).to.be.ok;
    expect(publicKey.rp.id).to.equal('auth.example.test');
    expect(publicKey.challenge).to.match(/^[A-Za-z0-9_-]{16,}$/);
  });

  it('verifyU2F rejects an unknown non-prebaked credential', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    const reg = await p.registerU2F('u1', 'localhost');
    let code: string | undefined;
    try {
      await p.verifyU2F('u1', {
        u2fId: reg.u2fId,
        publicKeyCredential: { id: 'bm9wZQ' },
        tokenName: '',
      });
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).to.equal('INVALID_CREDENTIALS');
    expect(await p.listAuthMethods('u1')).to.not.include('u2f');
  });
});
