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
  emailDeliveryEnabled: boolean
): SignupView {
  // Email-based signup (entry + link) needs email delivery to complete verification.
  // When delivery is off, hide the whole email path so signup is IdP-only.
  const allowEmailEntry = settings.disableLoginWithEmail !== true && emailDeliveryEnabled;
  const showIdpButtons = settings.allowExternalIdp && idps.length > 0;
  // Registration is effectively unavailable if policy disables it OR no entry method
  // is usable on the index screen (no IdP buttons AND no email entry — password/passkey
  // live behind email entry on /signup/method, so they can't rescue an empty index).
  const signupUnavailable = !settings.allowRegister || (!showIdpButtons && !allowEmailEntry);
  return {
    showIdpButtons,
    allowEmailEntry,
    showEmailLink: allowEmailEntry && emailDeliveryEnabled,
    showPasskey: settings.passkeysType === 'allowed',
    showPassword: settings.allowPassword,
    signupUnavailable,
  };
}
