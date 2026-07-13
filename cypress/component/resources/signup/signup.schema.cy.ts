// cypress/component/resources/signup/signup.schema.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/signup.schema.test.ts.
// Zod registration + password schemas → browser-side Chai only.
import { registerSchema, signupPasswordSchema } from '@/resources/signup/signup.schema';

describe('registerSchema', () => {
  it('accepts a valid registration and rejects an invalid email', () => {
    expect(
      registerSchema.safeParse({
        email: 'alice@acme.test',
        firstName: 'Alice',
        lastName: 'Acme',
      }).success
    ).to.equal(true);
    expect(
      registerSchema.safeParse({
        email: 'not-an-email',
        firstName: 'Alice',
        lastName: 'Acme',
      }).success
    ).to.equal(false);
  });
});

describe('signupPasswordSchema', () => {
  it('rejects mismatched passwords with a clear message and accepts matching ones', () => {
    const mismatch = signupPasswordSchema.safeParse({
      password: 'correct-horse',
      confirm: 'wrong-horse',
    });
    expect(mismatch.success).to.equal(false);
    if (!mismatch.success) {
      const confirmError = mismatch.error.issues.find((i) => i.path.includes('confirm'));
      expect(confirmError?.message).to.equal('Passwords must match');
    }

    expect(
      signupPasswordSchema.safeParse({ password: 'correct-horse', confirm: 'correct-horse' })
        .success
    ).to.equal(true);
  });
});
