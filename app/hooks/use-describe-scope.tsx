import { useLingui } from '@lingui/react/macro';

/**
 * Maps an OAuth scope identifier to a plain-language description for the consent screen.
 * Only the standard OIDC scopes are described; anything else (custom, resource or vendor
 * scopes) falls back to the raw identifier, so an unrecognised grant is shown as-is rather
 * than hidden or guessed at.
 */
export function useDescribeScope(): (scope: string) => string {
  const { t } = useLingui();
  return (scope: string): string => {
    switch (scope) {
      case 'openid':
        return t`Confirm your identity`;
      case 'profile':
        return t`View your name and profile details`;
      case 'email':
        return t`View your email address`;
      case 'phone':
        return t`View your phone number`;
      case 'address':
        return t`View your postal address`;
      case 'offline_access':
        return t`Stay signed in without asking you again`;
      default:
        return scope;
    }
  };
}
