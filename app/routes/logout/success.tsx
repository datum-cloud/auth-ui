import { AuthCard } from '@/components/auth-card/auth-card';
import { TrackOnMount } from '@/modules/analytics/fathom';
import { Trans } from '@lingui/react/macro';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Signed out' }];

export default function LogoutSuccess() {
  return (
    <AuthCard title={<Trans>You've been signed out</Trans>}>
      <TrackOnMount event="logout_completed" />
      <div className="text-center">
        <a href="/id/login" className="text-foreground text-sm underline">
          <Trans>Sign in again</Trans>
        </a>
      </div>
    </AuthCard>
  );
}
