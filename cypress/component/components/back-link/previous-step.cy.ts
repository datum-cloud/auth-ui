import { previousStepFor } from '@/components/back-link/previous-step';

describe('previousStepFor', () => {
  it('maps each ceremony step to its predecessor, including /setup/* enrollment screens, the MFA chooser, password-management screens, and terminal/headless steps (spec §5)', () => {
    expect(previousStepFor('/login/password')).to.equal('/login');
    expect(previousStepFor('/login/mfa')).to.equal('/login/password');
    expect(previousStepFor('/login/verify/email')).to.equal('/login/mfa');
    expect(previousStepFor('/signup/password')).to.equal('/signup');
    expect(previousStepFor('/password/reset')).to.equal('/login/password');

    // The /setup/* leaf enrollment screens are reached FROM the /setup/mfa
    // chooser, so Back returns there.
    expect(previousStepFor('/setup/passkey')).to.equal('/setup/mfa');
    expect(previousStepFor('/setup/email')).to.equal('/setup/mfa');

    // The chooser itself returns to /login/password (mirrors /login/mfa → /login/password).
    expect(previousStepFor('/setup/mfa')).to.equal('/login/password');

    // Password-management screens return to /login/password.
    expect(previousStepFor('/password/new')).to.equal('/login/password');

    // Terminal/headless steps have no predecessor.
    expect(previousStepFor('/login')).to.be.null;
    expect(previousStepFor('/signed-in')).to.be.null;
    expect(previousStepFor('/login/passkey')).to.be.null;
  });
});
