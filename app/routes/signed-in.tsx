import { AuthCard } from '@/components/auth-card/auth-card';
import { TrackOnMount } from '@/modules/analytics/fathom';
import { resolveSignedIn } from '@/resources/session';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken } from '@/server/csrf';
import { env } from '@/utils/env/env.server';
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

  if (outcome.kind === 'redirect') return redirect(outcome.location);

  // Terminal "You are signed in" page — mint a CSRF token for the sign-out form.
  const [csrfToken, setCookie] = await getCsrfToken(request);
  // DEVIATION (getCsrfToken null-guard): only set 'set-cookie' when non-null (same pattern as login.tsx).
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  return data({ loginName: outcome.loginName, csrfToken }, { headers });
}

export default function SignedIn() {
  const { loginName, csrfToken } = useLoaderData<typeof loader>();
  return (
    <AuthCard title={<Trans>You are signed in</Trans>}>
      <TrackOnMount event="login_completed" />
      <div className="flex flex-col gap-4 text-center">
        {/* ADAPTATION (contrast fix): text-foreground instead of text-muted-foreground
            (Phase 0 finding: muted-foreground fails WCAG AA at 3.47:1). */}
        {loginName ? <p className="text-foreground">{loginName}</p> : null}
        {/* Sign-out form posts to the logout INDEX route. Its action lives on
            routes/logout/index, which shares /id/logout with the action-less layout, so
            React Router needs ?index to target the index action — a native <form> won't
            append it the way RR <Form> does; without it the POST 405s on the layout.
            Explicit literal path because RR basename-prefixing only applies to RR <Form>.
            A logout journey should select form[action^="/id/logout"] — keep that prefix. */}
        <form method="post" action="/id/logout?index">
          <input type="hidden" name="csrf" value={csrfToken} />
          <Button type="primary" theme="solid" htmlType="submit" block>
            <Trans>Sign out</Trans>
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
