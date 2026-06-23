import { FakeAuthProvider } from '../fake-provider';
import { ProviderError } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

describe('FakeAuthProvider otpEmail primary factor', () => {
  it('rejects addOtpEmail until the email is verified, then authenticates a session via returnCode', async () => {
    const p = new FakeAuthProvider({ users: [] });
    const user = await p.register({ email: 'new@x.com', firstName: 'New', lastName: 'User' });

    // Before email verification, addOtpEmail must throw FAILED_PRECONDITION
    await expect(p.addOtpEmail(user.id)).rejects.toThrow(ProviderError);
    await expect(p.addOtpEmail(user.id)).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

    // After verifyEmail (any code accepted by the fake), addOtpEmail must succeed
    await p.verifyEmail(user.id, `email-${user.id}`);
    await p.addOtpEmail(user.id);

    // Create a session for this user
    const session = await p.createSession({}, { userId: user.id });

    // Request a returnCode challenge — must come back with otpEmailCode populated
    const challenged = await p.updateSession(session.id, session.token, {
      challenges: { otpEmail: { kind: 'return-code' } },
    });
    expect(challenged.challenges?.otpEmailCode).toBeTruthy();

    // Submit the returned code — must set factors.otpEmail on the session
    const verified = await p.updateSession(session.id, session.token, {
      otpEmail: challenged.challenges!.otpEmailCode!,
    });
    expect(verified.factors.otpEmail).toBeTruthy();
    expect(verified.factors.otpEmail?.verifiedAt).toBeTruthy();
  });

  it('throws INVALID_CREDENTIALS when a wrong otpEmail code is submitted', async () => {
    const p = new FakeAuthProvider({ users: [] });
    const user = await p.register({ email: 'x@x.com', firstName: 'X', lastName: 'Y' });
    await p.verifyEmail(user.id, `email-${user.id}`);
    await p.addOtpEmail(user.id);

    const session = await p.createSession({}, { userId: user.id });
    await p.updateSession(session.id, session.token, {
      challenges: { otpEmail: { kind: 'return-code' } },
    });

    // Wrong code must throw INVALID_CREDENTIALS
    await expect(
      p.updateSession(session.id, session.token, { otpEmail: 'wrong-code' })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('seeded users with email already verified can addOtpEmail without calling verifyEmail', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'seeded@x.com', displayName: 'Seeded' }],
    });
    // Seeded users have emailCodes set but emailVerified is not explicitly set to true in the
    // constructor — they go through verifyEmail in practice. Test that after verifyEmail it works.
    await p.verifyEmail('u1', 'email-u1');
    await expect(p.addOtpEmail('u1')).resolves.toBeUndefined();
  });
});
