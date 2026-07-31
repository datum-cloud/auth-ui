import { previousStepFor } from '@/components/back-link/previous-step';

describe('previousStepFor', () => {
  it('maps each ceremony step to its predecessor, including /setup/* enrollment screens, the MFA chooser, password-management screens, and terminal/headless steps (spec §5)', () => {
    expect(previousStepFor('/login/password')).to.equal('/login');
    expect(previousStepFor('/login/mfa')).to.equal('/login/password');
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
  });

  it('verify/* and security-key Back goes straight to /login, not /login/mfa (fixes the sole-factor loop, 2026-07-22)', () => {
    // resolveMfaPicker's sole-factor short-circuit (mfa.service.ts) redirects /login/mfa
    // straight back to whichever verify/security-key screen is the user's only enrolled
    // factor, BEFORE any picker UI renders — so a Back target of /login/mfa silently
    // loops. All four sole-factor USE_SCREEN targets go to /login instead.
    expect(previousStepFor('/login/verify/email')).to.equal('/login');
    expect(previousStepFor('/login/verify/sms')).to.equal('/login');
    expect(previousStepFor('/login/verify/authenticator')).to.equal('/login');
    expect(previousStepFor('/login/passkey')).to.equal('/login');
    expect(previousStepFor('/login/security-key')).to.equal('/login');
  });

  it('signup/method returns to /signup (mirrors signup/password)', () => {
    expect(previousStepFor('/signup/method')).to.equal('/signup');
  });
});
