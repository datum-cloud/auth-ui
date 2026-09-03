// cypress/component/modules/auth/providers/fake/fake-provider.p2.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/fake/__tests__/fake-provider.p2.test.ts.
//
// NOTE: this exercises a FAKE provider (test double / harness), not production security logic.
// One representative test per distinct capability.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

describe('FakeAuthProvider — Phase 2', () => {
  it('register creates a findable user; verifyEmail with the seeded code marks it verified and makes resendEmailCodeWithUrl throw ALREADY_DONE; setPasswordWithCode accepts the reset code from sendPasswordReset and rejects a wrong code', async () => {
    const p = new FakeAuthProvider();
    const user = await p.register({
      email: 'v@acme.test',
      firstName: 'V',
      lastName: 'E',
      password: 'pw',
    });
    expect(user.id).to.be.ok;
    expect(await p.findUser('v@acme.test')).to.include({ id: user.id });
    expect(p.isEmailVerified(user.id)).to.equal(false);

    await p.verifyEmail(user.id, p.lastEmailCode(user.id)!);
    expect(p.isEmailVerified(user.id)).to.equal(true);

    let err: { code?: string } | undefined;
    try {
      await p.resendEmailCodeWithUrl(user.id, 'tmpl');
    } catch (e) {
      err = e as { code?: string };
    }
    expect(err?.code).to.equal('ALREADY_DONE');

    const p2 = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    await p2.sendPasswordReset('u1', 'https://x/id/password/new?code={{.Code}}');
    expect(await p2.setPasswordWithCode('u1', p2.lastResetCode('u1')!, 'NewPw123!')).to.be
      .undefined;
    let resetErr: unknown;
    try {
      await p2.setPasswordWithCode('u1', 'wrong-code', 'NewPw123!');
    } catch (e) {
      resetErr = e;
    }
    expect(resetErr).to.exist;
  });
});
