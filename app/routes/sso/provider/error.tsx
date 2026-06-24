import { AuthCard } from '@/components/auth-card/auth-card';
import { paths } from '@/routes/paths';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { Link, useParams, useSearchParams } from 'react-router';

export function meta() {
  return [{ title: "Couldn't sign in" }];
}

const REASONS: Record<string, React.ReactNode> = {
  'context-missing': <Trans>The sign-in link was incomplete or expired.</Trans>,
  'access-denied': <Trans>That identity belongs to a different account.</Trans>,
  // ALREADY_EXISTS on link/auto-link — the IdP identity is already linked to a
  // different Datum account. Reuses the access-denied copy (i18n key 0ciILs) so no new
  // string is introduced, but as a DISTINCT reason it no longer collapses into the generic
  // signin_failed fallthrough below.
  'identity-linked-elsewhere': <Trans>That identity belongs to a different account.</Trans>,
  'creation-disabled': <Trans>No account was found and sign-up is not available.</Trans>,
  // Surfaced by sso.tsx when an LDAP IdP is used for account linking.
  'ldap-link-unsupported': (
    <Trans>
      This directory account can't be linked here yet. Sign in with your password instead.
    </Trans>
  ),
  // Generic provider-mapped reason (providerErrorCode → 'signin_failed'). Listed explicitly so
  // this expected code resolves to copy here instead of silently hitting the unknown-provider
  // fallback below (which names the provider as if something exotic broke).
  signin_failed: (
    <Trans>Couldn't complete sign-in. Return to your application and try again.</Trans>
  ),
};

export default function SsoError() {
  const { provider } = useParams();
  const [sp] = useSearchParams();
  const reason = sp.get('reason') ?? '';
  const message = REASONS[reason] ?? (
    <Trans>
      Something went wrong with <strong>{provider}</strong>.
    </Trans>
  );
  return (
    <AuthCard title={<Trans>Couldn't sign in</Trans>} description={message}>
      {/* LinkButton (single styled <a>) — NOT Button asChild, which emits
          <button><a> (nested-interactive axe violation in the prod build). */}
      <LinkButton
        theme="link"
        type="quaternary"
        className="mt-4"
        as={Link}
        href={paths.login.index()}>
        <Trans>Back to sign in</Trans>
      </LinkButton>
    </AuthCard>
  );
}
