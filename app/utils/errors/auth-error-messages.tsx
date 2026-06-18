import { useLingui } from '@lingui/react/macro';

/** Maps an auth error code (from resolveAuthError) to a user-facing Lingui message. */
export function useAuthErrorMessage() {
  const { t } = useLingui();
  return (code: string | undefined): string | undefined => {
    switch (code) {
      case 'PASSWORD_NEEDS_SYMBOL':
        return t`Password must contain a symbol.`;
      case 'PASSWORD_NEEDS_UPPERCASE':
        return t`Password must contain an uppercase letter.`;
      case 'PASSWORD_NEEDS_LOWERCASE':
        return t`Password must contain a lowercase letter.`;
      case 'PASSWORD_NEEDS_NUMBER':
        return t`Password must contain a number.`;
      case 'PASSWORD_TOO_SHORT':
        return t`Password is too short.`;
      case 'INVALID_CREDENTIALS':
        return t`Incorrect credentials. Please try again.`;
      case 'UNAVAILABLE':
        return t`Service temporarily unavailable. Please try again.`;
      case 'FAILED_PRECONDITION':
        return t`That action isn't available right now.`;
      case 'ALREADY_EXISTS':
        return t`An account with this email already exists. Try signing in instead.`;
      case 'INVALID_INPUT':
        return t`Please check your input and try again.`;
      case 'USER_NOT_FOUND':
        return t`We could not find an account for that identifier.`;
      case 'PHONE_LOGIN_DISABLED':
        return t`Phone sign-in isn't available — use your email or username.`;
      case 'EMAIL_LOGIN_DISABLED':
        return t`Email sign-in isn't available — use your username.`;
      case 'IDP_UNAVAILABLE':
        return t`This sign-in provider is currently unavailable. Please try again later.`;
      case 'NOT_FOUND':
        return t`We couldn't find what you were looking for. Please try again.`;
      case 'MFA_REQUIRED':
        return t`Additional verification is required to continue.`;
      case 'RATE_LIMITED':
        return t`Too many attempts. Please wait a moment and try again.`;
      case 'PERMISSION_DENIED':
        return t`You don't have permission to do that.`;
      case 'DEADLINE_EXCEEDED':
        return t`The request timed out. Please try again.`;
      case 'PASSWORD_EXPIRED':
        return t`Your password has expired. Please reset it to continue.`;
      case 'ALREADY_DONE':
        return t`That's already been done.`;
      case undefined:
        return undefined;
      default:
        return t`Something went wrong. Please try again.`;
    }
  };
}
