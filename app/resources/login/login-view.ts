import type { IdProvider, LoginSettings } from '@/modules/auth/types';
import { EMAIL_OTP_SIGNIN_ENABLED } from '@/resources/login/email-otp-signin';

export interface LoginView {
  showIdentifierForm: boolean;
  showContinue: boolean;
  showIdpButtons: boolean;
  showRegisterLink: boolean;
  showPasskeyPrompt: boolean;
  showEmailLink: boolean;
  showRecoveryLink: boolean;
  signInUnavailable: boolean;
}

/**
 * Derives what the /login identifier screen should render from the org's login
 * settings + active IdPs. Pure (no I/O) so it is exhaustively unit-tested; the
 * route maps these booleans straight to JSX presence.
 *
 * The identifier field is NOT password-specific: password, passkey, and email-link
 * all need a resolved user first (usernameless passkey is unsupported upstream —
 * zitadel/zitadel#8899), so gating it on allowPassword alone left passkey-only orgs
 * with an unreachable sign-in. Hence two flags:
 *   showIdentifierForm → any identifier-requiring method is possible
 *   showContinue       → a method exists BEHIND the identifier submit; without it
 *                        decideAfterIdentifier would return NO_SUPPORTED_METHOD, so
 *                        an email-link-only org shows the field without "Continue".
 *
 *   allowExternalIdp+ids     → render IdP buttons
 *   allowRegister            → render "Create account" link
 *   passkeysType==='allowed' → also surfaces the known-user passkey shortcut
 *   neither identifier nor IdP → render a "sign-in unavailable" state
 *   flag + passkeysType==='allowed' → render the "Can't use your passkey?" recovery link
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
  emailDeliveryEnabled: boolean,
  accountRecoveryEnabled = false
): LoginView {
  const showIdpButtons = settings.allowExternalIdp && idps.length > 0;
  const showRegisterLink = settings.allowRegister;
  const showPasskeyPrompt = settings.passkeysType === 'allowed';
  // Gated while email OTP sign-in is hidden — see EMAIL_OTP_SIGNIN_ENABLED.
  const showEmailLink =
    EMAIL_OTP_SIGNIN_ENABLED && settings.disableLoginWithEmail !== true && emailDeliveryEnabled;
  // Gated on the flag AND the org: offering recovery where passkeys are not allowed would send
  // the user into a flow requestRecovery refuses at the end, and that refusal is silent by design
  // (G7) — they would wait at "check your email" for mail that is never coming.
  const showRecoveryLink = accountRecoveryEnabled && settings.passkeysType === 'allowed';
  // "Continue" hands off to decideAfterIdentifier — only offer it when that can resolve
  // to a real method for this org.
  const showContinue = settings.allowPassword || showPasskeyPrompt;
  // Email-link signs in without any enrolled method (its action mints the OTP session
  // directly), so it justifies the field on its own — but not the Continue button.
  const showIdentifierForm = showContinue || showEmailLink;
  return {
    showIdentifierForm,
    showContinue,
    showIdpButtons,
    showRegisterLink,
    showPasskeyPrompt,
    showEmailLink,
    showRecoveryLink,
    // You can sign in iff you can enter an identifier or click an IdP. Passkey no longer
    // clears this on its own: without an identifier the ceremony cannot start, and the
    // old formula suppressed the message on the strength of an unreachable path.
    signInUnavailable: !showIdentifierForm && !showIdpButtons,
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
