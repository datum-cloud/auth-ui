import type { AuthActionErrorCode } from '@/utils/errors/auth-error-codes';
import { useLingui } from '@lingui/react/macro';

/**
 * Maps an auth error code (from resolveAuthError, or emitted by a resource/route) to a
 * user-facing Lingui message.
 *
 * The map is checked with `satisfies Record<AuthActionErrorCode, string>`: adding a code to
 * the union without a message here, or a message for a code that is not in the union, fails
 * typecheck. A string that is not a known code (stale client, tampered payload) still gets
 * the generic fallback at runtime.
 */
export function useAuthErrorMessage() {
  const { t } = useLingui();
  const generic = t`Something went wrong. Please try again.`;
  const invalidInput = t`Please check your input and try again.`;
  const providerFailure = t`We couldn't complete that request. Please try again.`;

  const messages = {
    PASSWORD_NEEDS_SYMBOL: t`Password must contain a symbol.`,
    PASSWORD_NEEDS_UPPERCASE: t`Password must contain an uppercase letter.`,
    PASSWORD_NEEDS_LOWERCASE: t`Password must contain a lowercase letter.`,
    PASSWORD_NEEDS_NUMBER: t`Password must contain a number.`,
    PASSWORD_TOO_SHORT: t`Password is too short.`,
    // A complexity failure whose broken rule the provider did not name.
    PASSWORD_COMPLEXITY: t`That password doesn't meet the password requirements.`,
    INVALID_CREDENTIALS: t`Incorrect credentials. Please try again.`,
    UNAVAILABLE: t`Service temporarily unavailable. Please try again.`,
    FAILED_PRECONDITION: t`That action isn't available right now.`,
    ALREADY_EXISTS: t`An account with this email already exists. Try signing in instead.`,
    INVALID_INPUT: invalidInput,
    // One code for every reCAPTCHA rejection (stale / no-token / rejected /
    // action-mismatch): they share a single user action, and naming which one fired
    // would tell a bot which wall it hit for no human benefit. Deliberately avoids
    // "verify" — that word means email verification everywhere else in this flow.
    RECAPTCHA_FAILED: t`That didn't go through. Please try again.`,
    USER_NOT_FOUND: t`We could not find an account for that identifier.`,
    PHONE_LOGIN_DISABLED: t`Phone sign-in isn't available — use your email or username.`,
    EMAIL_LOGIN_DISABLED: t`Email sign-in isn't available — use your username.`,
    IDP_UNAVAILABLE: t`This sign-in provider is currently unavailable. Please try again later.`,
    NOT_FOUND: t`We couldn't find what you were looking for. Please try again.`,
    // Device-code lookup (resources/device/device.service.ts) emits lowercase outcome codes.
    // Distinct, accurate inline messages (FormError/role=alert) instead of the generic fallback.
    not_found: t`That device code was not found. Check the code on your device and try again.`,
    invalid_code: t`That device code isn't valid. Check the code on your device and try again.`,
    // Lowercase twins from device.service.ts, sso-ldap.ts and sso-action.ts.
    invalid_input: invalidInput,
    provider_error: providerFailure,
    PROVIDER_ERROR: providerFailure,
    MFA_REQUIRED: t`Additional verification is required to continue.`,
    RATE_LIMITED: t`Too many attempts. Please wait a moment and try again.`,
    PERMISSION_DENIED: t`You don't have permission to do that.`,
    DEADLINE_EXCEEDED: t`The request timed out. Please try again.`,
    PASSWORD_EXPIRED: t`Your password has expired. Please reset it to continue.`,
    SESSION_EXPIRED: t`Your session has expired.`,
    NO_SUPPORTED_METHOD: t`No sign-in method is available for this account.`,
    PASSWORD_NOT_ALLOWED: t`Password sign-in isn't available for this account.`,
    ALREADY_DONE: t`That's already been done.`,
    INVALID_CODE: t`That code is invalid or has expired. Start over to get a new one.`,
    ACCOUNT_NOT_LINKED: t`That directory account isn't linked to an account here, so we can't sign you in with it.`,
    ENROLL_FAILED: t`We couldn't set up that sign-in method. Please try again.`,
    SUDO_REQUIRED: t`Please confirm it's you before making this change.`,
    LAST_METHOD: t`You can't remove your only sign-in method. Add another method first.`,
    DISCOVERY_FAILED: t`We couldn't sign you in with that passkey. Please try again.`,
    ALREADY_SIGNED_IN: t`You're already signed in.`,
    EXPIRED: t`That link has expired. Start over to get a new one.`,
    RECOVERY_EXPIRED: t`That recovery link has expired. Request a new one.`,
    // The provider adapter could not classify the failure.
    UNKNOWN: generic,
  } satisfies Record<AuthActionErrorCode, string>;

  return (code: string | undefined): string | undefined => {
    if (code === undefined) return undefined;
    // Own-property check: 'constructor' / 'toString' must not resolve to a prototype member.
    return Object.prototype.hasOwnProperty.call(messages, code)
      ? messages[code as AuthActionErrorCode]
      : generic;
  };
}
