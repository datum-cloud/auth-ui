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
  // Surfaced on the login/register flow when an unlinked IdP's email matches an existing account
  // and ALLOW_IDP_AUTO_LINK is off — no silent linking; the owner links it from /sso while signed in.
  'account-exists': (
    <Trans>
      An account with this email already exists. Sign in to that account, then link this provider
      from your account settings.
    </Trans>
  ),
  // ALREADY_EXISTS on auto-create (755-K1) — the same-email collision pre-check missed a real
  // account (loginName != email) and the duplicate reached Zitadel before being rejected. Reuses
  // the account-exists copy (same guidance, same fix) as a DISTINCT reason so it stays
  // distinguishable in redirects/logs from the pre-check's own account-exists hard-block.
  'registration-conflict': (
    <Trans>
      An account with this email already exists. Sign in to that account, then link this provider
      from your account settings.
    </Trans>
  ),
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
  // idpReturnUrls now carries requestId/organization on the failure URL (sso-callback and
  // sso-action thread them into the redirect too), so a mid-OIDC/SAML IdP failure lands here
  // WITH the ceremony context — thread it into "Back to sign in" so retrying resumes the same
  // ceremony instead of dropping into a bare, unscoped /login.
  const requestId = sp.get('requestId') ?? undefined;
  const organization = sp.get('organization') ?? undefined;
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
        href={paths.login.index({ requestId, organization })}>
        <Trans>Back to sign in</Trans>
      </LinkButton>
    </AuthCard>
  );
}
