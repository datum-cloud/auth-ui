import { AuthCard } from '@/components/auth-card';
import { Trans } from '@lingui/react/macro';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Signed out' }];

export default function LogoutSuccess() {
  return (
    <AuthCard title={<Trans>You've been signed out</Trans>}>
      <div className="text-center">
        <a href="/id/login" className="text-foreground text-sm underline">
          <Trans>Sign in again</Trans>
        </a>
      </div>
    </AuthCard>
  );
}
