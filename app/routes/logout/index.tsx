import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { SignOutButton } from '@/components/sign-out-button/sign-out-button';
import { mostRecent, readSessions } from '@/modules/auth/session/cookie';
import {
  performLogout,
  logoutOutcomeToResponse,
  completeOidcLogout,
  validatePostLogoutRedirect,
} from '@/resources/session';
import { APP_BASENAME } from '@/resources/shared/app-basename';
import { providerForRequest } from '@/server/auth-context.server';
import { assertCsrf, loaderCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
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

/** Hidden form value that asks the POST to sign out of every account in this browser. */
const SCOPE_ALL = 'all';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  // Zitadel's end_session bounces here with a logout_token. The token is NOT trusted as proof of
  // anything: any page can trigger this GET, so it never touches sessions. It renders the same
  // confirm page as the no-token path, and the sign-out-of-all runs only from the CSRF-protected
  // POST below (scope=all). The validated post_logout_redirect rides along in the form action.
  const endSessionAll = url.searchParams.has('logout_token');
  if (endSessionAll) {
    logAuthEvent('logout', 'failure', { reason: 'logout_token_unverified' });
  }

  const { csrfToken, headers } = await loaderCsrf(request);
  // Show which account is being signed out of, mirroring password/change.tsx's pattern.
  // Empty string (no active session) falls back to the generic confirm copy below.
  const loginName = mostRecent(await readSessions(request))?.loginName ?? '';
  const postLogoutRedirect = endSessionAll ? validatePostLogoutRedirect(request) : null;
  return data({ csrfToken, loginName, endSessionAll, postLogoutRedirect }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  await assertCsrf(request, form); // CSRF on the state-changing POST

  const provider = providerForRequest(request);
  // scope=all: the end_session handshake, confirmed by the user — every session in the cookie.
  const outcome =
    form.get('scope') === SCOPE_ALL
      ? await completeOidcLogout(provider, request)
      : await performLogout(provider, request);
  return logoutOutcomeToResponse(outcome);
}

/** The confirm form for the end_session handshake: posts scope=all, keeps the redirect target. */
function EndSessionForm({
  csrf,
  postLogoutRedirect,
}: {
  csrf: string;
  postLogoutRedirect: string | null;
}) {
  const query = new URLSearchParams({ index: '' });
  if (postLogoutRedirect) query.set('post_logout_redirect', postLogoutRedirect);
  return (
    <form method="post" action={`${APP_BASENAME}/logout?${query.toString()}`}>
      <AuthFormFields csrf={csrf} />
      <input type="hidden" name="scope" value={SCOPE_ALL} />
      <Button type="primary" theme="solid" htmlType="submit" block>
        <Trans>Sign out</Trans>
      </Button>
    </form>
  );
}

export default function Logout() {
  const { csrfToken, loginName, endSessionAll, postLogoutRedirect } =
    useLoaderData<typeof loader>();
  return (
    <AuthCard
      title={<Trans>Sign out</Trans>}
      description={
        loginName ? (
          <IdentityBadge loginName={loginName} verb={<Trans>Sign out of</Trans>} showLink={false} />
        ) : (
          <Trans>Are you sure you want to sign out?</Trans>
        )
      }>
      <div className="flex flex-col gap-4 text-center">
        {endSessionAll ? (
          <EndSessionForm csrf={csrfToken} postLogoutRedirect={postLogoutRedirect} />
        ) : (
          <SignOutButton csrf={csrfToken} emphasis="primary" />
        )}
      </div>
    </AuthCard>
  );
}
