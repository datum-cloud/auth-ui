import { previousStepFor } from '@/components/back-link/previous-step';

describe('previousStepFor', () => {
  it('maps each ceremony step to its predecessor (spec §5)', () => {
    expect(previousStepFor('/login/password')).to.equal('/login');
    expect(previousStepFor('/login/mfa')).to.equal('/login/password');
    expect(previousStepFor('/login/verify/email')).to.equal('/login/mfa');
    expect(previousStepFor('/login/verify/sms')).to.equal('/login/mfa');
    expect(previousStepFor('/login/verify/authenticator')).to.equal('/login/mfa');
    expect(previousStepFor('/signup/password')).to.equal('/signup');
    expect(previousStepFor('/password/reset')).to.equal('/login/password');
  });

  // The six /setup/* leaf enrollment screens are reached FROM the
  // /setup/mfa chooser, so Back returns there; the chooser itself returns to
  // /login/password (mirrors /login/mfa → /login/password).
  it('maps each /setup/* enrollment screen back to the MFA chooser', () => {
    expect(previousStepFor('/setup/passkey')).to.equal('/setup/mfa');
    expect(previousStepFor('/setup/security-key')).to.equal('/setup/mfa');
    expect(previousStepFor('/setup/authenticator')).to.equal('/setup/mfa');
    expect(previousStepFor('/setup/email')).to.equal('/setup/mfa');
    expect(previousStepFor('/setup/sms')).to.equal('/setup/mfa');
  });

  it('maps the /setup/mfa chooser back to /login/password', () => {
    expect(previousStepFor('/setup/mfa')).to.equal('/login/password');
  });

  it('maps the password-management screens back to /login/password', () => {
    expect(previousStepFor('/password/new')).to.equal('/login/password');
    expect(previousStepFor('/password/change')).to.equal('/login/password');
  });

  it('returns null for steps with no predecessor (terminal/headless)', () => {
    expect(previousStepFor('/login')).to.be.null;
    expect(previousStepFor('/signed-in')).to.be.null;
    expect(previousStepFor('/login/passkey')).to.be.null;
  });
});
