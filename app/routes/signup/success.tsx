import { AuthCard } from '@/components/auth-card/auth-card';
import { FormError } from '@/components/form-error/form-error';
import { WebAuthnReasonCopy } from '@/components/webauthn-button/webauthn-button';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { usePasskeyLoginCeremony } from '@/hooks/use-passkey-login-ceremony';
import {
  byLoginName,
  readSessions,
  removeSession,
  serializeSessions,
} from '@/modules/auth/session/cookie';
import { clearPasskeyHint } from '@/modules/auth/session/passkey-hint';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';
import {
  data,
  Link,
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Your account is ready' }];

/**
 * Terminal for passkey signup: account created, address verified, passkey registered. The page
 * then signs the user in with that passkey in place (issue #153), so they never retype their
 * address on /login. Registering a passkey adds no factor to the signup session, whose only
 * factor is otpEmail; the assertion here is what earns the primary factor /authorize requires.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? undefined;
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;

  const headers = new Headers();

  // Clear the passkey hint. It drives /login's passkey shortcut and conditional-UI autofill, and
  // conditional UI arms a discoverable request whose arming MINTS a session — so the next
  // discover returns 409 already_signed_in. The sign-in below writes it back on success.
  headers.append('set-cookie', await clearPasskeyHint());

  // KEEP a live signup session: the passkey assertion lands on it. Only a session the provider no
  // longer knows is dropped; it cannot sign anyone in, and arming a challenge on it would fail.
  // A live session is never evicted, so this GET cannot be turned into a cross-site logout.
  if (loginName) {
    const sessions = await readSessions(request);
    const entry = byLoginName(sessions, loginName, organization);
    if (entry) {
      const provider = providerForRequest(request);
      const live = await provider.getSession(entry.id, entry.token).catch(() => null);
      if (!live) {
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
  const query = { loginName, requestId, organization };

  const ceremony = usePasskeyLoginCeremony({ loginName: loginName ?? '', requestId, organization });
  const serverError = useAuthActionError(ceremony.actionData);
  const busy = ceremony.phase !== 'idle';

  // Start the sign-in on arrival: the user just made this passkey, so asking them to click again
  // would be the extra step #153 removes. One-shot, as on /login/method. That attempt has no
  // click behind it, and WebKit rejects navigator.credentials.get() without one, so its failure
  // stays silent; the button below is the way forward and reports its own failures.
  const autoBegunRef = useRef(false);
  const [suppressAutoBeginReason, setSuppressAutoBeginReason] = useState(false);
  useEffect(() => {
    if (!loginName || autoBegunRef.current) return;
    autoBegunRef.current = true;
    setSuppressAutoBeginReason(true);
    ceremony.begin();
  }, [loginName, ceremony]);

  const reason = suppressAutoBeginReason ? null : ceremony.reason;

  return (
    <AuthCard
      title={<Trans>Your account is ready</Trans>}
      description={
        loginName ? (
          <Trans>
            Signing you in as <strong>{loginName}</strong> with your new passkey.
          </Trans>
        ) : (
          <Trans>Your passkey is set up. Sign in with it to continue.</Trans>
        )
      }>
      {reason ? (
        <FormError>
          <WebAuthnReasonCopy reason={reason} />
        </FormError>
      ) : serverError ? (
        <FormError>{serverError}</FormError>
      ) : null}

      <div className="flex flex-col gap-3">
        {loginName ? (
          // A real <a> to /login/passkey, upgraded in place once hydrated (same convention as
          // /login/method): unhydrated, the browser follows the href to the standalone screen.
          <LinkButton
            type="primary"
            theme="solid"
            block
            as={Link}
            href={paths.login.passkey(query)}
            aria-disabled={busy}
            aria-busy={busy}
            onClick={(e) => {
              e.preventDefault();
              if (busy) return;
              setSuppressAutoBeginReason(false);
              ceremony.begin();
            }}>
            <Trans>Sign in with your passkey</Trans>
          </LinkButton>
        ) : null}
        {/* LinkButton (renders a single styled <a>) — NOT Button asChild, which
            emits <button><a> (nested-interactive axe violation in the prod build). */}
        <LinkButton
          theme="link"
          type="quaternary"
          as={Link}
          href={paths.login.index({ requestId, organization })}>
          <Trans>Go to sign in</Trans>
        </LinkButton>
      </div>
    </AuthCard>
  );
}
