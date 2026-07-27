import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';

export interface SignOutButtonProps {
  csrf: string;
  /**
   * Visual weight. 'primary' (solid) for screens where signing out IS the point
   * (signed-in.tsx, logout/index.tsx). 'secondary' (link) for account-management
   * screens where sign-out is a minor action among many (sso/index.tsx, passkeys.tsx).
   * Default: 'secondary'.
   */
  emphasis?: 'primary' | 'secondary';
}

/**
 * Shared "Sign out" control. POSTs to /id/logout?index — the ?index is required so a
 * native <form> hits the logout INDEX route's action, not its action-less layout.
 */
export function SignOutButton({ csrf, emphasis = 'secondary' }: SignOutButtonProps) {
  return (
    <form method="post" action="/id/logout?index">
      <AuthFormFields csrf={csrf} />
      {emphasis === 'primary' ? (
        <Button type="primary" theme="solid" htmlType="submit" block>
          <Trans>Sign out</Trans>
        </Button>
      ) : (
        <Button type="secondary" theme="link" htmlType="submit" block>
          <Trans>Sign out</Trans>
        </Button>
      )}
    </form>
  );
}
