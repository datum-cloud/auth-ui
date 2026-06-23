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

  // The six /setup/* leaf enrollment screens are reached FROM the
  // /setup/mfa chooser, so Back returns there; the chooser itself returns to
  // /login/password (mirrors /login/mfa → /login/password).
  it('maps each /setup/* enrollment screen back to the MFA chooser', () => {
    expect(previousStepFor('/setup/passkey')).toBe('/setup/mfa');
    expect(previousStepFor('/setup/security-key')).toBe('/setup/mfa');
    expect(previousStepFor('/setup/authenticator')).toBe('/setup/mfa');
    expect(previousStepFor('/setup/email')).toBe('/setup/mfa');
    expect(previousStepFor('/setup/sms')).toBe('/setup/mfa');
  });
  it('maps the /setup/mfa chooser back to /login/password', () => {
    expect(previousStepFor('/setup/mfa')).toBe('/login/password');
  });

  // The two password-management screens that previously had no Back
  // control. /password/new (reset-code landing) and /password/change both follow
  // a /login/password step.
  it('maps the password-management screens back to /login/password', () => {
    expect(previousStepFor('/password/new')).toBe('/login/password');
    expect(previousStepFor('/password/change')).toBe('/login/password');
  });

  it('returns null for steps with no predecessor (terminal/headless)', () => {
    expect(previousStepFor('/login')).toBeNull();
    expect(previousStepFor('/signed-in')).toBeNull();
    expect(previousStepFor('/login/passkey')).toBeNull();
  });
});
