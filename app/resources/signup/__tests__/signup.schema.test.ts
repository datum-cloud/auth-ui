import { registerSchema, signupPasswordSchema } from '../signup.schema';
import { describe, it, expect } from 'vitest';

describe('registerSchema', () => {
  it('accepts a valid registration', () => {
    const result = registerSchema.safeParse({
      email: 'alice@acme.test',
      firstName: 'Alice',
      lastName: 'Acme',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = registerSchema.safeParse({
      email: 'not-an-email',
      firstName: 'Alice',
      lastName: 'Acme',
    });
    expect(result.success).toBe(false);
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
    expect(result.success).toBe(true);
  });
});

describe('signupPasswordSchema', () => {
  it('rejects when password and confirm do not match', () => {
    const result = signupPasswordSchema.safeParse({
      password: 'correct-horse',
      confirm: 'wrong-horse',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const confirmError = result.error.issues.find((i) => i.path.includes('confirm'));
      expect(confirmError?.message).toBe('Passwords must match');
    }
  });

  it('accepts when password and confirm match', () => {
    const result = signupPasswordSchema.safeParse({
      password: 'correct-horse',
      confirm: 'correct-horse',
    });
    expect(result.success).toBe(true);
  });
});
