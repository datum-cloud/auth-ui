import { AuthCard } from '@/components/auth-card/auth-card';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { SignOutButton } from '@/components/sign-out-button/sign-out-button';
import { mostRecent, readSessions } from '@/modules/auth/session/cookie';
import { performLogout, logoutOutcomeToResponse, completeOidcLogout } from '@/resources/session';
import { providerForRequest } from '@/server/auth-context.server';
import { assertCsrf, loaderCsrf } from '@/server/csrf';
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

  const { csrfToken, headers } = await loaderCsrf(request);
  // Show which account is being signed out of, mirroring password/change.tsx's pattern.
  // Empty string (no active session) falls back to the generic confirm copy below.
  const loginName = mostRecent(await readSessions(request))?.loginName ?? '';
  return data({ csrfToken, loginName }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  await assertCsrf(request, form); // CSRF on the state-changing POST

  const provider = providerForRequest(request);
  const outcome = await performLogout(provider, request);
  return logoutOutcomeToResponse(outcome);
}

export default function Logout() {
  const { csrfToken, loginName } = useLoaderData<typeof loader>();
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
        <SignOutButton csrf={csrfToken} emphasis="primary" />
      </div>
    </AuthCard>
  );
}
