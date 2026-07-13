import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { TrackOnMount } from '@/modules/analytics/fathom';
import { resolveSignedIn } from '@/resources/session';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf } from '@/server/csrf';
import { env } from '@/server/infra/env.server';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
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
  return data({ loginName: outcome.loginName, csrfToken }, { headers });
}

export default function SignedIn() {
  const { loginName, csrfToken } = useLoaderData<typeof loader>();

  return (
    <AuthCard
      title={<Trans>You are signed in</Trans>}
      description={
        loginName ? (
          <Trans>
            You are signed in as <strong>{loginName}</strong>
          </Trans>
        ) : null
      }>
      <TrackOnMount event="login_completed" />
      <div className="flex flex-col gap-4 text-center">
        {/* Sign-out form posts to the logout INDEX route. Its action lives on
            routes/logout/index, which shares /id/logout with the action-less layout, so
            React Router needs ?index to target the index action — a native <form> won't
            append it the way RR <Form> does; without it the POST 405s on the layout.
            Explicit literal path because RR basename-prefixing only applies to RR <Form>.
            A logout journey should select form[action^="/id/logout"] — keep that prefix. */}
        <form method="post" action="/id/logout?index">
          <AuthFormFields csrf={csrfToken} />
          <Button type="primary" theme="solid" htmlType="submit" block>
            <Trans>Sign out</Trans>
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
