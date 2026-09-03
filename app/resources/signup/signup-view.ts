import type { IdProvider, LoginSettings } from '@/modules/auth/types';

export interface SignupView {
  showIdpButtons: boolean;
  allowEmailEntry: boolean;
  showEmailLink: boolean;
  showPasskey: boolean;
  showPassword: boolean;
  /** True when the index screen would be blank: policy disabled OR no usable entry method. */
  signupUnavailable: boolean;
}

/**
 * Pure settings→render-booleans for the signup identifier + method screens. Mirrors
 * resolveLoginView so the routes map these straight to JSX presence.
 *
 * @param requireEmailVerification - whether EMAIL_VERIFICATION env is on (true = default/prod).
 *   When false (staging/no-delivery deployment), password signup can skip verification and
 *   complete without sending any email, so email entry is safe to show even without delivery.
 */
export function resolveSignupView(
  settings: Pick<
    LoginSettings,
    | 'allowRegister'
    | 'allowExternalIdp'
    | 'allowPassword'
    | 'passkeysType'
    | 'disableLoginWithEmail'
  >,
  idps: IdProvider[],
  emailDeliveryEnabled: boolean,
  requireEmailVerification: boolean
): SignupView {
  // Email entry is shown when:
  //   a) policy allows it (disableLoginWithEmail !== true), AND
  //   b) either delivery is on (normal path), OR
  //      password signup is available AND verification is skipped (no-delivery staging):
  //      password with emailVerified:true completes without any email, so showing entry is safe.
  // Without both conditions for (b), showing email entry without delivery would strand the user
  // on a "check your email" screen they can never complete.
  const allowEmailEntry =
    settings.disableLoginWithEmail !== true &&
    (emailDeliveryEnabled || (settings.allowPassword && !requireEmailVerification));

  const showIdpButtons = settings.allowExternalIdp && idps.length > 0;

  // Registration is effectively unavailable if policy disables it OR no entry method
  // is usable on the index screen (no IdP buttons AND no email entry — password/passkey
  // live behind email entry on /signup/method, so they can't rescue an empty index).
  const signupUnavailable = !settings.allowRegister || (!showIdpButtons && !allowEmailEntry);

  // Email-link (passwordless) signup always requires delivery to send the magic link.
  // showEmailLink stays false without delivery even when allowEmailEntry is true.
  const showEmailLink = allowEmailEntry && emailDeliveryEnabled;

  // Passkey signup IS the email-link flow now (the passkey intent registers and sends the same
  // verification mail; the nudge happens on /signup/complete), so it needs DELIVERY — and this
  // flag mirrors the route action's guard exactly: policy + AUTH_EMAIL_DELIVERY_ENABLED.
  //
  // Deliberately NOT gated on allowEmailEntry, which is looser: that is true without delivery on
  // a password + verification-off deployment, because password signup completes with no mail at
  // all. The passkey intent cannot — the action rejects it with 400 INVALID_INPUT whenever
  // delivery is off (routes/signup/method.tsx) — so gating on policy alone would render a button
  // whose only possible outcome is a generic error.
  //
  // Also deliberately NOT gated on showEmailLink, which is TIGHTER: under disableLoginWithEmail
  // the email-link button hides but the action still accepts intent=passkey, so borrowing that
  // gate would hide a button that works. Match the guard, nothing more.
  const showPasskey = settings.passkeysType === 'allowed' && emailDeliveryEnabled;

  return {
    showIdpButtons,
    allowEmailEntry,
    showEmailLink,
    showPasskey,
    showPassword: settings.allowPassword,
    signupUnavailable,
  };
}
