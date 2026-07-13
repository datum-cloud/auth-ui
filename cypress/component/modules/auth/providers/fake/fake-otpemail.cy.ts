// cypress/component/modules/auth/providers/fake/fake-otpemail.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/fake/__tests__/fake-otpemail.test.ts.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { ProviderError } from '@/modules/auth/types';

describe('FakeAuthProvider otpEmail primary factor', () => {
  it('rejects addOtpEmail until the email is verified, then authenticates a session via returnCode', async () => {
    const p = new FakeAuthProvider({ users: [] });
    const user = await p.register({ email: 'new@x.com', firstName: 'New', lastName: 'User' });

    // Before email verification, addOtpEmail must throw FAILED_PRECONDITION
    let err: { code?: string } | undefined;
    try {
      await p.addOtpEmail(user.id);
    } catch (e) {
      err = e as { code?: string };
    }
    expect(err).to.be.instanceOf(ProviderError);
    expect(err?.code).to.equal('FAILED_PRECONDITION');

    // After verifyEmail (any code accepted by the fake), addOtpEmail must succeed
    await p.verifyEmail(user.id, `email-${user.id}`);
    await p.addOtpEmail(user.id);

    const session = await p.createSession({}, { userId: user.id });

    // Request a returnCode challenge — must come back with otpEmailCode populated
    const challenged = await p.updateSession(session.id, session.token, {
      challenges: { otpEmail: { kind: 'return-code' } },
    });
    expect(challenged.challenges?.otpEmailCode).to.be.ok;

    // Submit the returned code — must set factors.otpEmail on the session
    const verified = await p.updateSession(session.id, session.token, {
      otpEmail: challenged.challenges!.otpEmailCode!,
    });
    expect(verified.factors.otpEmail).to.be.ok;
    expect(verified.factors.otpEmail?.verifiedAt).to.be.ok;
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

    let err: { code?: string } | undefined;
    try {
      await p.updateSession(session.id, session.token, { otpEmail: 'wrong-code' });
    } catch (e) {
      err = e as { code?: string };
    }
    expect(err?.code).to.equal('INVALID_CREDENTIALS');
  });
});
