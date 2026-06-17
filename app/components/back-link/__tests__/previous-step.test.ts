import { previousStepFor } from '@/components/back-link/previous-step';
import { describe, it, expect } from 'vitest';

describe('previousStepFor', () => {
  it('maps each ceremony step to its predecessor (spec §5)', () => {
    expect(previousStepFor('/login/password')).toBe('/login');
    expect(previousStepFor('/login/mfa')).toBe('/login/password');
    expect(previousStepFor('/login/verify/email')).toBe('/login/mfa');
    expect(previousStepFor('/login/verify/sms')).toBe('/login/mfa');
    expect(previousStepFor('/login/verify/authenticator')).toBe('/login/mfa');
    expect(previousStepFor('/signup/password')).toBe('/signup');
    expect(previousStepFor('/password/reset')).toBe('/login/password');
  });
  it('returns null for steps with no predecessor (terminal/headless)', () => {
    expect(previousStepFor('/login')).toBeNull();
    expect(previousStepFor('/signed-in')).toBeNull();
    expect(previousStepFor('/login/passkey')).toBeNull();
  });
});
