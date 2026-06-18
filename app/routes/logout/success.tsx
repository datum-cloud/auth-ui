import { AuthCard } from '@/components/auth-card/auth-card';
import { TrackOnMount } from '@/modules/analytics/fathom';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { Link } from 'react-router';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Signed out' }];

export default function LogoutSuccess() {
  return (
    <AuthCard title={<Trans>You've been signed out</Trans>}>
      <TrackOnMount event="logout_completed" />
      <LinkButton theme="link" type="quaternary" as={Link} href="/">
        <Trans>Sign in again</Trans>
      </LinkButton>
    </AuthCard>
  );
}
