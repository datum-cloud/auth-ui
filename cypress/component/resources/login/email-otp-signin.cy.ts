// cypress/component/resources/login/email-otp-signin.cy.ts
//
// NO-MOUNT: the one predicate every "is otp_email a sign-in method" reader must use.
// Pins the CURRENT posture (sign-in hidden). When EMAIL_OTP_SIGNIN_ENABLED is flipped to
// true, the first two expectations below flip with it — see the header of the module.
import {
  EMAIL_OTP_SIGNIN_ENABLED,
  isEmailOtpSignInUsable,
} from '@/resources/login/email-otp-signin';

describe('email-otp-signin — isEmailOtpSignInUsable', () => {
  it('is false while sign-in is hidden, even with email delivery on', () => {
    expect(EMAIL_OTP_SIGNIN_ENABLED, 'posture pinned by this spec').to.equal(false);
    expect(isEmailOtpSignInUsable(true)).to.equal(false);
  });

  it('is false without email delivery, whatever the constant says', () => {
    expect(isEmailOtpSignInUsable(false)).to.equal(false);
  });
});
