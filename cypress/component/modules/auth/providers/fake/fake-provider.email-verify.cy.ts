// cypress/component/modules/auth/providers/fake/fake-provider.email-verify.cy.ts
//
// Component (no-mount) port of
// app/modules/auth/providers/fake/__tests__/fake-provider.email-verify.test.ts.
//
// NOTE: this exercises a FAKE provider (test double / harness), not production security logic.
// One representative test covering the register(emailVerified) and markEmailVerified paths.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

describe('FakeAuthProvider — email verification', () => {
  it('register honors emailVerified (true marks it immediately, default/false leaves it unverified), and markEmailVerified marks it idempotently without an email arg', async () => {
    const p = new FakeAuthProvider();
    const verified = await p.register({
      email: 'pre-verified@acme.test',
      firstName: 'Pre',
      lastName: 'Verified',
      emailVerified: true,
    });
    expect(p.isEmailVerified(verified.id)).to.equal(true);

    const unverified = await p.register({
      email: 'unverified@acme.test',
      firstName: 'Un',
      lastName: 'Verified',
    });
    expect(p.isEmailVerified(unverified.id)).to.equal(false);

    const seeded = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'mark@acme.test', displayName: 'Mark' }],
    });
    expect(seeded.isEmailVerified('u1')).to.equal(false);
    await seeded.markEmailVerified('u1');
    await seeded.markEmailVerified('u1'); // idempotent
    expect(seeded.isEmailVerified('u1')).to.equal(true);
  });
});
