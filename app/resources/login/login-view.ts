import type { IdProvider, LoginSettings } from '@/modules/auth/types';

export interface LoginView {
  showPasswordForm: boolean;
  showIdpButtons: boolean;
  showRegisterLink: boolean;
  showPasskeyPrompt: boolean;
  showEmailLink: boolean;
  signInUnavailable: boolean;
}

/**
 * Derives what the /login identifier screen should render from the org's login
 * settings + active IdPs. Pure (no I/O) so it is exhaustively unit-tested; the
 * route maps these booleans straight to JSX presence. Mirrors the spec audit:
 *   allowPassword            → render the identifier/password entry form
 *   allowExternalIdp+ids     → render IdP buttons
 *   allowRegister            → render "Create account" link
 *   passkeysType==='allowed' → surface a "Sign in with a passkey" prompt (P2)
 *   none of the above        → render a "sign-in unavailable" state
 */
export function resolveLoginView(
  settings: Pick<
    LoginSettings,
    | 'allowPassword'
    | 'allowRegister'
    | 'allowExternalIdp'
    | 'passkeysType'
    | 'disableLoginWithEmail'
  >,
  idps: IdProvider[],
  emailDeliveryEnabled: boolean
): LoginView {
  const showPasswordForm = settings.allowPassword;
  const showIdpButtons = settings.allowExternalIdp && idps.length > 0;
  const showRegisterLink = settings.allowRegister;
  const showPasskeyPrompt = settings.passkeysType === 'allowed';
  const showEmailLink = settings.disableLoginWithEmail !== true && emailDeliveryEnabled;
  return {
    showPasswordForm,
    showIdpButtons,
    showRegisterLink,
    showPasskeyPrompt,
    showEmailLink,
    // Passkey is a real sign-in path, so it also clears the "unavailable" state.
    signInUnavailable: !showPasswordForm && !showIdpButtons && !showPasskeyPrompt,
  };
}

/**
 * Structured remaining-attempts state for the password screen, derived from the
 * provider's failed/max counts (returned by verifyLoginPassword). Kept as data — NOT a
 * formatted string — so the component renders it through Lingui (<Plural>) and stays
 * translatable. Returns null when the provider did not report counts (older settings /
 * non-credential errors).
 */
export type AttemptsState = { kind: 'locked' } | { kind: 'remaining'; count: number } | null;

export function attemptsRemaining(failedAttempts?: number, maxAttempts?: number): AttemptsState {
  if (failedAttempts == null || maxAttempts == null) return null;
  const remaining = Math.max(0, maxAttempts - failedAttempts);
  return remaining <= 0 ? { kind: 'locked' } : { kind: 'remaining', count: remaining };
}

export interface IdentifierField {
  allowEmail: boolean;
  allowPhone: boolean;
  rejectPhone: boolean;
}

/**
 * Derives the identifier field's allowed types from the org's email/phone login policy
 * (username is always allowed). `rejectPhone` drives the client + server phone-format
 * validation. Pure ⇒ unit-tested; the component maps allowEmail/allowPhone to translated copy.
 */
export function resolveIdentifierField(
  settings: Pick<LoginSettings, 'disableLoginWithEmail' | 'disableLoginWithPhone'>
): IdentifierField {
  const allowEmail = settings.disableLoginWithEmail !== true;
  const allowPhone = settings.disableLoginWithPhone !== true;
  return { allowEmail, allowPhone, rejectPhone: !allowPhone };
}
