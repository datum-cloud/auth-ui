// cypress/component/resources/signup/signup.schema.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/signup.schema.test.ts.
// Zod registration + password schemas → browser-side Chai only.
import { registerSchema, signupPasswordSchema } from '@/resources/signup/signup.schema';

describe('registerSchema / signupPasswordSchema', () => {
  it('accepts a valid registration, rejects a bad email, and requires matching passwords', () => {
    for (const [label, email, accepted] of [
      ['valid email', 'alice@acme.test', true],
      ['invalid email', 'not-an-email', false],
    ] as const) {
      expect(
        registerSchema.safeParse({ email, firstName: 'Alice', lastName: 'Acme' }).success,
        label
      ).to.equal(accepted);
    }

    const mismatch = signupPasswordSchema.safeParse({
      password: 'correct-horse',
      confirm: 'wrong-horse',
    });
    expect(mismatch.success, 'mismatched passwords rejected').to.equal(false);
    if (!mismatch.success) {
      const confirmError = mismatch.error.issues.find((i) => i.path.includes('confirm'));
      expect(confirmError?.message, 'error on the confirm path').to.equal('Passwords must match');
    }

    expect(
      signupPasswordSchema.safeParse({ password: 'correct-horse', confirm: 'correct-horse' })
        .success,
      'matching passwords accepted'
    ).to.equal(true);
  });
});
