// cypress/component/modules/auth/providers/fake/fake-provider.p2.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/fake/__tests__/fake-provider.p2.test.ts.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

describe('FakeAuthProvider — Phase 2', () => {
  it('register creates a findable user and returns it', async () => {
    const p = new FakeAuthProvider();
    const user = await p.register({
      email: 'new@acme.test',
      firstName: 'New',
      lastName: 'User',
      password: 'pw',
    });
    expect(user.id).to.be.ok;
    expect(await p.findUser('new@acme.test')).to.include({ id: user.id });
  });

  it('register always leaves email unverified until verifyEmail is called', async () => {
    const p = new FakeAuthProvider();
    const noPw = await p.register({ email: 'np@acme.test', firstName: 'No', lastName: 'Pw' });
    expect(p.isEmailVerified(noPw.id)).to.equal(false);
    const withPw = await p.register({
      email: 'pw@acme.test',
      firstName: 'With',
      lastName: 'Pw',
      password: 'pw',
    });
    expect(p.isEmailVerified(withPw.id)).to.equal(false);
  });

  it('verifyEmail with the seeded code marks the email verified', async () => {
    const p = new FakeAuthProvider();
    const user = await p.register({
      email: 'v@acme.test',
      firstName: 'V',
      lastName: 'E',
      password: 'pw',
    });
    await p.verifyEmail(user.id, p.lastEmailCode(user.id)!);
    expect(p.isEmailVerified(user.id)).to.equal(true);
  });

  it('setPasswordWithCode accepts the reset code issued by sendPasswordReset', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    await p.sendPasswordReset('u1', 'https://x/id/password/new?code={{.Code}}');
    expect(await p.setPasswordWithCode('u1', p.lastResetCode('u1')!, 'NewPw123!')).to.be.undefined;
    let err: unknown;
    try {
      await p.setPasswordWithCode('u1', 'wrong-code', 'NewPw123!');
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
  });

  it('resendEmailCode on an already-verified user throws ALREADY_DONE', async () => {
    const p = new FakeAuthProvider();
    const user = await p.register({
      email: 'done@acme.test',
      firstName: 'D',
      lastName: 'One',
      password: 'pw',
    });
    await p.verifyEmail(user.id, p.lastEmailCode(user.id)!);
    let err: { code?: string } | undefined;
    try {
      await p.resendEmailCode(user.id, 'tmpl');
    } catch (e) {
      err = e as { code?: string };
    }
    expect(err?.code).to.equal('ALREADY_DONE');
  });
});
