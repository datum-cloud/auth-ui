import type { IdProvider, LoginSettings } from '@/modules/auth/types';

export interface SignupView {
  showIdpButtons: boolean;
  allowEmailEntry: boolean;
  showEmailLink: boolean;
  showPasskey: boolean;
  showPassword: boolean;
  registrationDisabled: boolean;
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
  const allowEmailEntry = settings.disableLoginWithEmail !== true;
  return {
    showIdpButtons: settings.allowExternalIdp && idps.length > 0,
    allowEmailEntry,
    showEmailLink: allowEmailEntry && emailDeliveryEnabled,
    showPasskey: settings.passkeysType === 'allowed',
    showPassword: settings.allowPassword,
    registrationDisabled: !settings.allowRegister,
  };
}
