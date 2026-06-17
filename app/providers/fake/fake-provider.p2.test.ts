import { FakeAuthProvider } from './fake-provider';
import { describe, it, expect } from 'vitest';

describe('FakeAuthProvider — Phase 2', () => {
  it('register creates a findable user and returns it', async () => {
    const p = new FakeAuthProvider();
    const user = await p.register({
      email: 'new@acme.test',
      firstName: 'New',
      lastName: 'User',
      password: 'pw',
    });
    expect(user.id).toBeTruthy();
    expect(await p.findUser('new@acme.test')).toMatchObject({ id: user.id });
  });

  it('register always leaves email unverified until verifyEmail is called', async () => {
    const p = new FakeAuthProvider();
    const noPw = await p.register({ email: 'np@acme.test', firstName: 'No', lastName: 'Pw' });
    expect(p.isEmailVerified(noPw.id)).toBe(false);
    const withPw = await p.register({
      email: 'pw@acme.test',
      firstName: 'With',
      lastName: 'Pw',
      password: 'pw',
    });
    expect(p.isEmailVerified(withPw.id)).toBe(false);
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
    expect(p.isEmailVerified(user.id)).toBe(true);
  });

  it('setPasswordWithCode accepts the reset code issued by sendPasswordReset', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'a@acme.test' }] });
    await p.sendPasswordReset('u1', 'https://x/id/password/new?code={{.Code}}');
    await expect(
      p.setPasswordWithCode('u1', p.lastResetCode('u1')!, 'NewPw123!')
    ).resolves.toBeUndefined();
    await expect(p.setPasswordWithCode('u1', 'wrong-code', 'NewPw123!')).rejects.toThrow();
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
    await expect(p.resendEmailCode(user.id, 'tmpl')).rejects.toMatchObject({
      code: 'ALREADY_DONE',
    });
  });
});
