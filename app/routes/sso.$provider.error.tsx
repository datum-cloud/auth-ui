import { AuthCard } from '@/components/auth-card';
import { Trans } from '@lingui/react/macro';
import { Link, useParams, useSearchParams } from 'react-router';

export function meta() {
  return [{ title: "Couldn't sign in" }];
}

const REASONS: Record<string, React.ReactNode> = {
  'context-missing': <Trans>The sign-in link was incomplete or expired.</Trans>,
  'access-denied': <Trans>That identity belongs to a different account.</Trans>,
  'creation-disabled': <Trans>No account was found and sign-up is not available.</Trans>,
  // CODE-MIN-06: surfaced by sso.tsx when an LDAP IdP is used for account linking.
  'ldap-link-unsupported': (
    <Trans>
      This directory account can't be linked here yet. Sign in with your password instead.
    </Trans>
  ),
};

export default function SsoError() {
  const { provider } = useParams();
  const [sp] = useSearchParams();
  const reason = sp.get('reason') ?? '';
  const message = REASONS[reason] ?? <Trans>Something went wrong with {provider}.</Trans>;
  return (
    <AuthCard title={<Trans>Couldn't sign in</Trans>}>
      <p className="text-foreground text-center">{message}</p>
      <Link to="/login" className="mt-4 text-sm underline">
        <Trans>Back to sign in</Trans>
      </Link>
    </AuthCard>
  );
}
