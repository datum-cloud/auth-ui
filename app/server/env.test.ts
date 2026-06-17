import { requireEmailVerification } from './env';
import { describe, it, expect } from 'vitest';

describe('requireEmailVerification', () => {
  it('defaults to true when EMAIL_VERIFICATION is unset', () => {
    expect(requireEmailVerification({})).toBe(true);
  });

  it('defaults to true when EMAIL_VERIFICATION is set to an arbitrary string', () => {
    expect(requireEmailVerification({ EMAIL_VERIFICATION: 'true' })).toBe(true);
    expect(requireEmailVerification({ EMAIL_VERIFICATION: '1' })).toBe(true);
    expect(requireEmailVerification({ EMAIL_VERIFICATION: 'yes' })).toBe(true);
  });

  it('returns false only when EMAIL_VERIFICATION is exactly "false"', () => {
    expect(requireEmailVerification({ EMAIL_VERIFICATION: 'false' })).toBe(false);
  });
});
