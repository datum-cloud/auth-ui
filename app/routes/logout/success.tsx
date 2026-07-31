import { AuthCard } from '@/components/auth-card/auth-card';
import { TrackOnMount, clearIdentifiedUser } from '@/modules/analytics/rybbit';
import { completeOidcLogout } from '@/resources/session';
import { providerForRequest } from '@/server/auth-context.server';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { useEffect } from 'react';
import { Link, data, type LoaderFunctionArgs } from 'react-router';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Signed out' }];

/**
 * Terminal sign-out page — and the OIDC RP's REGISTERED post-logout landing page
 * (`post-logout-redirect-uris` points straight here), which makes it a cookie-clearing
 * site, not just a render.
 *
 * On that hop Zitadel ends its own SSO session and 302s the browser here DIRECTLY, so
 * /logout never runs and its clearing never happens. The local `sessions` and
 * `passkey-hint` cookies then outlive the provider session, and because listSessions()
 * judges liveness from cookie-local expiry alone (a provider-side termination is invisible
 * to it), the orphaned entry reads as live for its full 24h. That suppressed the /login
 * passkey fast path via `hasLiveSession`, leaving returning users on a bare email field.
 *
 * Arriving here means logout already happened, so complete it locally: terminate any
 * residual v2 sessions provider-side (best-effort, per entry) and clear both cookies.
 * Idempotent — the redirect from /logout arrives with an already-empty cookie, which
 * makes this a no-op, and direct navigation while signed in is a deliberate sign-out.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const outcome = await completeOidcLogout(provider, request);

  const headers = new Headers();
  headers.append('set-cookie', outcome.setCookie);
  if (outcome.clearHintCookie) headers.append('set-cookie', outcome.clearHintCookie);

  return data(null, { headers });
}

export default function LogoutSuccess() {
  useEffect(() => {
    clearIdentifiedUser();
  }, []);

  return (
    <AuthCard
      title={<Trans>You've been signed out</Trans>}
      description={
        <Trans>
          Your session has ended and you've been securely signed out of Datum. You can safely close
          this tab, or sign back in any time to pick up where you left off.
        </Trans>
      }>
      <TrackOnMount event="logout_completed" />
      <LinkButton theme="link" type="quaternary" as={Link} href="/">
        <Trans>Sign in again</Trans>
      </LinkButton>
    </AuthCard>
  );
}
