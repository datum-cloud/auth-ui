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
      case 'INVALID_INPUT':
        return t`Please check your input and try again.`;
      case undefined:
        return undefined;
      default:
        return t`Something went wrong. Please try again.`;
    }
  };
}
