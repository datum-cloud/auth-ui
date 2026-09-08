/**
 * Email OTP sign-in is HIDDEN for now.
 *
 * Both entry points read "Email me a sign-in link", but the flow behind them sends a one-time
 * code and lands on /login/verify/email ("Enter your email code") — it promised something it
 * never delivered.
 *
 * Hidden, not deleted: /login's `intent=email-link` action branch and the /login/verify/email
 * route both still work, so re-enabling is flipping this one constant, after fixing the copy.
 *
 * CONSEQUENCE while false: an account whose ONLY enrolled method is otpEmail has nothing left to
 * offer, so /login/method sends it to /error. Passkey signup enrols otpEmail when it verifies the
 * address, so an account that verified but abandoned before enrolling a passkey is in exactly
 * that state — and cannot sign up again, since the address now reports ALREADY_EXISTS.
 */
export const EMAIL_OTP_SIGNIN_ENABLED: boolean = false;

/**
 * The ONE answer to "is otp_email a sign-in method right now". Every reader that decides
 * routing, availability or "does this account still have a backup method" must go through
 * here — a reader that checks only `emailDeliveryEnabled` treats OTP as usable while the UI
 * hides it, which is how a passkey-only account could remove its last passkey (C10).
 */
export function isEmailOtpSignInUsable(emailDeliveryEnabled: boolean): boolean {
  return EMAIL_OTP_SIGNIN_ENABLED && emailDeliveryEnabled;
}
