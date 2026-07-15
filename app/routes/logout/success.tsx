import { AuthCard } from '@/components/auth-card/auth-card';
import { TrackOnMount } from '@/modules/analytics/rybbit';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { Link } from 'react-router';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Signed out' }];

export default function LogoutSuccess() {
  return (
    <AuthCard
      title={<Trans>You've been signed out</Trans>}
      description={
        <Trans>
          Your session has ended and you've been securely signed out of Datum. You can safely close
          this tab, or sign back in any time to pick up where you left off.
        </Trans>
      }>
      <TrackOnMount event="logout_completed" />
      <LinkButton theme="link" type="quaternary" as={Link} href="/">
        <Trans>Sign in again</Trans>
      </LinkButton>
    </AuthCard>
  );
}
