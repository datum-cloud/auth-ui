import { AuthCard } from '@/components/auth-card/auth-card';
import type { IdProvider } from '@/modules/auth/types';
import { resolveSsoLink, type SsoLinkSignInRequired } from '@/resources/sso';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { Button, LinkButton } from '@datum-cloud/datum-ui/button';
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

  // Base path via the typed registry; the returnTo query stays hand-built with
  // encodeURIComponent so the emitted URL is BYTE-IDENTICAL (URLSearchParams would encode a
  // space as "+" instead of "%20").
  const loginHref = `${paths.login.index()}?returnTo=${encodeURIComponent(returnTo)}`;

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
                  <form method="get" action={paths.login.index()}>
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

        {/* LinkButton (single styled <a>) — NOT Button asChild, which emits
            <button><a> (nested-interactive axe violation in the prod build). */}
        <LinkButton theme="link" type="quaternary" as={Link} href={loginHref}>
          <Trans>Back</Trans>
        </LinkButton>
      </div>
    </AuthCard>
  );
}
