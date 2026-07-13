// app/routes/signup/complete.tsx
//
// Landing route for the passwordless email-link signup flow.
// Zitadel fills the URL template placeholders and redirects the user here:
//   /signup/complete?code=<CODE>&userId=<UID>&organization=<ORG>&next=passkey
//
// Loader-only route (GET): verifies the email, enrolls otpEmail, self-authenticates
// the session, and redirects to the (skippable) passkey nudge. Replay-safe: a spent
// code causes completeEmailLinkSignup to throw inside verifyEmail → caught → 400
// expired state, never a 500.
import { AuthCard } from '@/components/auth-card/auth-card';
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { serializeLastUsedLogin } from '@/modules/auth/session/last-used-login';
import { ProviderError } from '@/modules/auth/types';
import { completeEmailLinkSignup } from '@/resources/signup';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { getOrCreateFingerprintId, userAgentFromRequest } from '@/server/user-agent';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import {
  data,
  redirect,
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Link } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Verifying your email' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') ?? '';
  const userId = url.searchParams.get('userId') ?? '';
  const organization = url.searchParams.get('organization') ?? undefined;
  const next = url.searchParams.get('next') ?? undefined;
  const deviceTrackingToken = url.searchParams.get('deviceTrackingToken') ?? undefined;
  // The email link carries the oidc_/saml_ requestId; without threading it the ceremony can
  // never resume at /authorize after email-link signup completes.
  const requestId = url.searchParams.get('requestId') ?? undefined;

  // Guard: both code and userId are required — without them the link is structurally invalid.
  // Surface requestId/organization alongside the error so "Start over" can resume the SAME
  // ceremony instead of dropping into an unscoped /signup.
  if (!code || !userId) {
    return data({ error: 'EXPIRED' as const, requestId, organization }, { status: 400 });
  }

  const provider = providerForRequest(request);

  try {
    // Resolve the user to get their loginName. getUser must be INSIDE the try: a stale/invalid
    // userId makes Zitadel throw NOT_FOUND, which OUTSIDE the try would surface as a 500 instead
    // of the friendly 'EXPIRED' state a second click on an old link should show.
    const user = await provider.getUser(userId);
    if (!user) {
      return data({ error: 'EXPIRED' as const, requestId, organization }, { status: 400 });
    }
    const sessions = await readSessions(request);
    // Ensure a fingerprintId cookie exists for this browser. Email-link signup lands here
    // without a prior session, so brand-new users may not yet have a fingerprint cookie.
    // The minted id feeds userAgentFromRequest (not deviceTrackingToken, which is a MaxMind
    // fraud signal kept only in the service metadata path).
    const [fingerprintId, fpCookie] = getOrCreateFingerprintId(request);
    const result = await completeEmailLinkSignup(provider, sessions, {
      userId,
      code,
      loginName: user.loginName,
      organization,
      requestId,
      next: next === 'passkey' ? 'passkey' : undefined,
      deviceTrackingToken,
      userAgent: userAgentFromRequest(request, fingerprintId),
    });
    const headers = new Headers();
    headers.append('set-cookie', await serializeSessions(result.sessions));
    headers.append('set-cookie', await serializeLastUsedLogin('email'));
    if (fpCookie) headers.append('set-cookie', fpCookie);
    return redirect(result.target, { headers });
  } catch (err) {
    // Bad/expired/replayed code, or otpEmail FAILED_PRECONDITION — surface the friendly
    // expired state so a second click never causes a 500. Unexpected (non-provider)
    // errors propagate to the ErrorBoundary rather than masquerading as "expired".
    if (err instanceof ProviderError) {
      return data({ error: 'EXPIRED' as const, requestId, organization }, { status: 400 });
    }
    throw err;
  }
}

export default function SignupComplete() {
  const loaderData = useLoaderData<typeof loader>();

  // TypeScript: loader either redirects (no render) or returns { error }
  const hasError = 'error' in loaderData && loaderData.error === 'EXPIRED';

  if (hasError) {
    // Carry the ceremony context threaded by the loader so "Start over" resumes the SAME
    // OIDC/SAML/device ceremony instead of dropping into an unscoped /signup.
    const { requestId, organization } = loaderData as {
      error: 'EXPIRED';
      requestId?: string;
      organization?: string;
    };
    return (
      <AuthCard
        title={<Trans>Link expired</Trans>}
        description={<Trans>This sign-in link is invalid or has expired.</Trans>}>
        <div className="flex flex-col gap-4 text-center">
          {/* LinkButton (single styled <a>) — NOT Button asChild, which emits
              <button><a> (nested-interactive axe violation in the prod build). */}
          <LinkButton
            theme="link"
            type="quaternary"
            block
            as={Link}
            href={paths.signup.index({ requestId, organization })}>
            <Trans>Start over</Trans>
          </LinkButton>
        </div>
      </AuthCard>
    );
  }

  // Should not reach here — loader always redirects on success.
  return null;
}
