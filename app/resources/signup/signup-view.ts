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

  // Passkey signup (registerPasskeyFirst) sends a verification email ONLY when verification is
  // required; with verification off it registers without one. We still hide passkey whenever
  // delivery is off — even in the verification-off case where it could technically proceed — to
  // keep the no-delivery method screen to the single well-exercised password path and avoid any
  // "check your email" stranding. (allowEmailEntry above deliberately makes the opposite call for
  // password entry, which completes with no email at all.)
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
