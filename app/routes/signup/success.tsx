import { AuthCard } from '@/components/auth-card/auth-card';
import {
  byLoginName,
  readSessions,
  removeSession,
  serializeSessions,
} from '@/modules/auth/session/cookie';
import { clearPasskeyHint } from '@/modules/auth/session/passkey-hint';
import { primaryFresh } from '@/resources/shared/lifetimes';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import {
  data,
  Link,
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Your account is ready' }];

/**
 * Terminal for passkey signup: account created, address verified, passkey registered.
 *
 * Enrollment no longer hands off to /login/passkey (checkAfter=true). That earned a primary factor
 * but demanded a second biometric prompt seconds after the first, and returned FAILED_PRECONDITION
 * on staging.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? undefined;
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;

  // Retire the signup session: authenticated by otpEmail ALONE, and enrolling a passkey adds no
  // factor, so it arrives permanently incomplete. Left behind it is harmful — signing in mints a
  // SECOND session (addSession dedupes by id, not loginName), and prompt=select_account then shows
  // two entries for one account, where picking the stale one dead-ends on /login/passkey.
  //
  // GUARDED BY A FACTOR CHECK, not the URL: this is a GET, so evicting on ?loginName alone would
  // make a cross-site request a one-click logout. Only a session with no primary factor is
  // dropped — one that could not sign anyone in anyway.
  const headers = new Headers();

  // Clear the passkey hint. It names an account this browser holds no usable session for, and
  // breaks both passkey paths: the /login shortcut bounces (no session to arm a challenge), and
  // conditional-UI autofill arms a discoverable request whose arming MINTS a session — so the next
  // discover returns 409 already_signed_in. Without it the user goes through the identifier step,
  // which is what establishes a ceremony session.
  headers.append('set-cookie', await clearPasskeyHint());

  if (loginName) {
    const sessions = await readSessions(request);
    const entry = byLoginName(sessions, loginName, organization);
    if (entry) {
      const provider = providerForRequest(request);
      // A dead/unreadable session is retired too — it can no longer authenticate anyone, and
      // leaving it behind produces the same polluted picker.
      const live = await provider.getSession(entry.id, entry.token).catch(() => null);
      if (!live || !primaryFresh(live.factors, Date.now(), undefined)) {
        headers.append('set-cookie', await serializeSessions(removeSession(sessions, entry.id)));
      }
    }
  }

  return data(
    {
      loginName,
      // Threaded so a signup started inside an OIDC/SAML ceremony resumes it on sign-in rather
      // than dropping the user into an unscoped /login.
      requestId,
      organization,
    },
    { headers }
  );
}

export default function SignupSuccess() {
  const { loginName, requestId, organization } = useLoaderData<typeof loader>();
  return (
    <AuthCard
      title={<Trans>Your account is ready</Trans>}
      description={
        loginName ? (
          <Trans>
            Your passkey is set up. Sign in with it using <strong>{loginName}</strong>.
          </Trans>
        ) : (
          <Trans>Your passkey is set up. Sign in with it to continue.</Trans>
        )
      }>
      {/* LinkButton (renders a single styled <a>) — NOT Button asChild, which
          emits <button><a> (nested-interactive axe violation in the prod build). */}
      <LinkButton
        theme="link"
        type="quaternary"
        as={Link}
        href={paths.login.index({ requestId, organization })}>
        <Trans>Go to sign in</Trans>
      </LinkButton>
    </AuthCard>
  );
}
