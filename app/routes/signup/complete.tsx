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
import { ProviderError } from '@/modules/auth/types';
import { completeEmailLinkSignup } from '@/resources/signup';
import { providerForRequest } from '@/server/auth-context.server';
import { Button } from '@datum-cloud/datum-ui/button';
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

  // Guard: both code and userId are required — without them the link is structurally invalid.
  if (!code || !userId) {
    return data({ error: 'EXPIRED' as const }, { status: 400 });
  }

  const provider = providerForRequest(request);

  // Resolve the user to get their loginName (needed for the session and the redirect target).
  const user = await provider.getUser(userId);
  if (!user) {
    return data({ error: 'EXPIRED' as const }, { status: 400 });
  }

  try {
    const sessions = await readSessions(request);
    const result = await completeEmailLinkSignup(provider, sessions, {
      userId,
      code,
      loginName: user.loginName,
      organization,
      next: next === 'passkey' ? 'passkey' : undefined,
    });
    return redirect(result.target, {
      headers: { 'set-cookie': await serializeSessions(result.sessions) },
    });
  } catch (err) {
    // Bad/expired/replayed code, or otpEmail FAILED_PRECONDITION — surface the friendly
    // expired state so a second click never causes a 500. Unexpected (non-provider)
    // errors propagate to the ErrorBoundary rather than masquerading as "expired".
    if (err instanceof ProviderError) {
      return data({ error: 'EXPIRED' as const }, { status: 400 });
    }
    throw err;
  }
}

export default function SignupComplete() {
  const loaderData = useLoaderData<typeof loader>();

  // TypeScript: loader either redirects (no render) or returns { error }
  const hasError = 'error' in loaderData && loaderData.error === 'EXPIRED';

  if (hasError) {
    return (
      <AuthCard
        title={<Trans>Link expired</Trans>}
        description={<Trans>This sign-in link is invalid or has expired.</Trans>}>
        <div className="flex flex-col gap-4 text-center">
          <Button theme="link" type="quaternary" block asChild>
            <Link to="/signup">
              <Trans>Start over</Trans>
            </Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  // Should not reach here — loader always redirects on success.
  return null;
}
