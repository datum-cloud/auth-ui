import { AuthCard } from '@/components/auth-card/auth-card';
import { performLogout, logoutOutcomeToResponse, completeOidcLogout } from '@/resources/session';
import { providerForRequest } from '@/server/auth-context.server';
import { assertCsrf, getCsrfToken } from '@/server/csrf';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import {
  data,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Sign out' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  // Zitadel-initiated logout: end_session bounced here with a logout_token. Complete the
  // handshake (terminate all v2 sessions, clear the cookie) and redirect to the validated
  // destination. The no-token path below is the user-initiated standalone confirm page.
  if (url.searchParams.has('logout_token')) {
    const provider = providerForRequest(request);
    const outcome = await completeOidcLogout(provider, request);
    return logoutOutcomeToResponse(outcome);
  }

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  return data({ csrfToken }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  await assertCsrf(request, form); // CSRF on the state-changing POST

  const provider = providerForRequest(request);
  const outcome = await performLogout(provider, request);
  return logoutOutcomeToResponse(outcome);
}

export default function Logout() {
  const { csrfToken } = useLoaderData<typeof loader>();
  return (
    <AuthCard title={<Trans>Sign out</Trans>}>
      <div className="flex flex-col gap-4 text-center">
        <p className="text-foreground">
          <Trans>Are you sure you want to sign out?</Trans>
        </p>
        {/* ?index targets routes/logout/index (which owns the action). Without it RR
            routes this native POST to the action-less logout/layout → 405. RR <Form>
            adds ?index automatically; a native <form> must carry it explicitly. */}
        <form method="post" action="?index">
          <input type="hidden" name="csrf" value={csrfToken} />
          <Button type="primary" theme="solid" htmlType="submit" block>
            <Trans>Sign out</Trans>
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
