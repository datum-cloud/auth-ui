import { AuthCard } from '@/components/auth-card/auth-card';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { SignOutButton } from '@/components/sign-out-button/sign-out-button';
import { TrackOnMount, identifyUser } from '@/modules/analytics/rybbit';
import { resolveSignedIn } from '@/resources/session';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf } from '@/server/csrf';
import { env } from '@/server/infra/env.server';
import { Trans } from '@lingui/react/macro';
import { useEffect } from 'react';
import { data, redirect, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Signed in' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const outcome = await resolveSignedIn(provider, request, {
    consoleUrl: `${env.ZITADEL_API_URL}/ui/console`,
    defaultAppUrl: env.DEFAULT_APP_URL,
  });

  // Ceremony hand-back (OIDC/SAML → /authorize, device_ → the /device/authorize consent screen)
  // or a configured post-login destination. A device grant is NEVER auto-completed here — it
  // routes to the CSRF-protected /device/authorize consent screen (see resolveSignedIn).
  if (outcome.kind === 'redirect') return redirect(outcome.location);

  // Terminal "You are signed in" page — mint a CSRF token for the sign-out form.
  const { csrfToken, headers } = await loaderCsrf(request);
  return data({ loginName: outcome.loginName, userId: outcome.userId, csrfToken }, { headers });
}

export default function SignedIn() {
  const { loginName, userId, csrfToken } = useLoaderData<typeof loader>();

  useEffect(() => {
    if (userId) identifyUser(userId, loginName ? { email: loginName } : undefined);
  }, [userId, loginName]);

  return (
    <AuthCard
      title={<Trans>You are signed in</Trans>}
      description={
        loginName ? (
          <IdentityBadge
            loginName={loginName}
            verb={<Trans>You are signed in as</Trans>}
            linkLabel={<Trans>Use a different account</Trans>}
            linkTarget={paths.accounts()}
          />
        ) : null
      }>
      <TrackOnMount event="login_completed" />
      <div className="flex flex-col gap-4 text-center">
        <SignOutButton csrf={csrfToken} emphasis="primary" />
      </div>
    </AuthCard>
  );
}
