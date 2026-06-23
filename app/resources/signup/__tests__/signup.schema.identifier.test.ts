import { signupIdentifierSchema, signupMethodSchema } from '../signup.schema';
import { describe, it, expect } from 'vitest';

describe('signupIdentifierSchema', () => {
  it('accepts a valid email', () => {
    expect(signupIdentifierSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
  });
  it('rejects a non-email', () => {
    expect(signupIdentifierSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });
});

describe('signupMethodSchema', () => {
  it('accepts a valid method intent', () => {
    expect(
      signupMethodSchema.safeParse({
        intent: 'email-link',
        loginName: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
      }).success
    ).toBe(true);
  });
  it('rejects an unknown intent', () => {
    expect(
      signupMethodSchema.safeParse({
        intent: 'sms',
        loginName: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
      }).success
    ).toBe(false);
  });
});
