// cypress/component/resources/signup/signup.schema.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/signup.schema.test.ts.
// Zod registration + password schemas → browser-side Chai only.
import { registerSchema, signupPasswordSchema } from '@/resources/signup/signup.schema';

describe('registerSchema', () => {
  it('accepts a valid registration', () => {
    const result = registerSchema.safeParse({
      email: 'alice@acme.test',
      firstName: 'Alice',
      lastName: 'Acme',
    });
    expect(result.success).to.equal(true);
  });

  it('rejects an invalid email', () => {
    const result = registerSchema.safeParse({
      email: 'not-an-email',
      firstName: 'Alice',
      lastName: 'Acme',
    });
    expect(result.success).to.equal(false);
  });

  it('accepts optional fields when provided', () => {
    const result = registerSchema.safeParse({
      email: 'alice@acme.test',
      firstName: 'Alice',
      lastName: 'Acme',
      organization: 'org1',
      requestId: 'oidc_1',
      deviceTrackingToken: 'tok123',
    });
    expect(result.success).to.equal(true);
  });
});

describe('signupPasswordSchema', () => {
  it('rejects when password and confirm do not match', () => {
    const result = signupPasswordSchema.safeParse({
      password: 'correct-horse',
      confirm: 'wrong-horse',
    });
    expect(result.success).to.equal(false);
    if (!result.success) {
      const confirmError = result.error.issues.find((i) => i.path.includes('confirm'));
      expect(confirmError?.message).to.equal('Passwords must match');
    }
  });

  it('accepts when password and confirm match', () => {
    const result = signupPasswordSchema.safeParse({
      password: 'correct-horse',
      confirm: 'correct-horse',
    });
    expect(result.success).to.equal(true);
  });
});
