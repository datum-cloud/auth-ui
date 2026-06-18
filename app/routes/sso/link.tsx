import { AuthCard } from '@/components/auth-card/auth-card';
import type { IdProvider } from '@/modules/auth/types';
import { resolveSsoLink, type SsoLinkSignInRequired } from '@/resources/sso';
import { providerForRequest } from '@/server/auth-context.server';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { redirect, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { MetaFunction } from 'react-router';
import { Link } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Link account' }];

// ---------------------------------------------------------------------------
// Loader — parse request → resolveSsoLink → render data / redirect.
// All session-gating + link-intent orchestration lives in the service.
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const result = await resolveSsoLink(provider, request);
  if (result.kind === 'redirect') return redirect(result.location);
  return result.data;
}

// ---------------------------------------------------------------------------
// Component — sign-in-required state only (session + provider redirects in loader)
// ---------------------------------------------------------------------------

type LoaderData = SsoLinkSignInRequired;

export default function SsoLinkPage() {
  const { providers, returnTo } = useLoaderData<LoaderData>();

  const loginHref = `/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <AuthCard
      title={<Trans>Link your account</Trans>}
      description={<Trans>You must be signed in to link an external account.</Trans>}>
      <div className="flex w-full flex-col gap-4">
        {providers.length > 0 ? (
          <section className="flex flex-col gap-3">
            <p className="text-foreground text-sm font-medium">
              <Trans>Sign in with</Trans>
            </p>
            <ul className="flex flex-col gap-2">
              {providers.map((idp: IdProvider) => (
                <li key={idp.id}>
                  <form method="get" action="/login">
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <Button type="primary" theme="solid" htmlType="submit" block>
                      {idp.name}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Button theme="link" type="quaternary" asChild>
          <Link to={loginHref}>
            <Trans>Back</Trans>
          </Link>
        </Button>
      </div>
    </AuthCard>
  );
}
