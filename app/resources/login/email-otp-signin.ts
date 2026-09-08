/**
 * Email OTP sign-in is HIDDEN for now.
 *
 * Both entry points read "Email me a sign-in link", but the flow behind them sends a one-time
 * code and lands on /login/verify/email ("Enter your email code") — it promised something it
 * never delivered.
 *
 * Hidden AND refused, not deleted: the `intent=email-link` action branch, /login/verify/email
 * and app/resources/otp/ all still exist, so re-enabling is flipping this one constant after
 * fixing the copy. Readers that must agree with it, all through isEmailOtpSignInUsable():
 *   - login-view.ts        — the /login "Email me a sign-in link" button (also needs org policy)
 *   - method-options.ts    — the /login/method chooser
 *   - login-decision.ts    — post-identifier routing
 *   - shared/usable-methods.ts — the last-method guard and the backup-method banner (C10)
 *   - routes/login/index.tsx — the intent=email-link action branch (C10)
 *
 * When this flips to true, these specs flip with it:
 *   cypress/component/resources/login/email-otp-signin.cy.ts
 *   cypress/component/resources/passkeys/passkeys.service.cy.ts  (the C10 case)
 *   cypress/component/resources/login/login-decision.cy.ts        (the C10 case)
 *   cypress/component/routes/login/email-otp-signin-hidden.cy.ts
 *   cypress/component/routes/login/method-chooser.cy.ts           (the intent=email-link case)
 *
 * CONSEQUENCE while false: an account whose ONLY enrolled method is otpEmail has nothing left to
 * offer, so /login sends it to /error. Passkey signup enrols otpEmail when it verifies the
 * address, so an account that verified but abandoned before enrolling a passkey is in exactly
 * that state — and cannot sign up again, since the address now reports ALREADY_EXISTS. Phase C
 * (auth-ui#112, C3) gives that account /recover.
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
