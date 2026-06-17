import { trustedAppOrigin } from './_shared/app-origin.server';
import { idpReturnUrls } from './_shared/idp-return-urls';
import { AuthCard } from '@/components/auth-card';
import { slugToProvider } from '@/providers/idp-slug';
import type { IdProvider } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { logAuthEvent } from '@/server/observability';
import { readSessions, mostRecent } from '@/session/cookie';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { redirect, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Link account' }];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);
  const wantedSlug = url.searchParams.get('provider');
  const organization = url.searchParams.get('organization') ?? undefined;

  const entries = await readSessions(request);
  const recent = mostRecent(entries);
  const session = recent ? await provider.getSession(recent.id, recent.token) : null;

  // (c) No session → render sign-in-required prompt
  if (!session?.user?.id) {
    const active = provider.capabilities.externalIdp
      ? await provider.getActiveIdPs(organization)
      : [];
    return {
      mode: 'sign-in-required' as const,
      providers: active,
      returnTo: url.pathname + url.search,
    };
  }

  // (b) Session, no provider → redirect to /sso management screen
  if (!wantedSlug) {
    return redirect('/sso');
  }

  // (a) Session + specific provider → start link intent and redirect
  const active = provider.capabilities.externalIdp
    ? await provider.getActiveIdPs(organization)
    : [];
  const target = slugToProvider(wantedSlug, active);
  if (!target) {
    return redirect('/sso');
  }

  const origin = trustedAppOrigin(request);
  const { success, failure } = idpReturnUrls(origin, wantedSlug, { link: true, organization });
  const { authUrl } = await provider.startIdpIntent(target.id, { success, failure });

  logAuthEvent('idp.link.start', authUrl ? 'success' : 'failure', {
    idpId: target.id,
    userId: session.user.id,
    slug: wantedSlug,
  });

  return authUrl ? redirect(authUrl) : redirect('/sso');
}

// ---------------------------------------------------------------------------
// Component — sign-in-required state only (session + provider redirects in loader)
// ---------------------------------------------------------------------------

type LoaderData = Extract<Awaited<ReturnType<typeof loader>>, { mode: 'sign-in-required' }>;

export default function SsoLinkPage() {
  const { providers, returnTo } = useLoaderData<LoaderData>();

  const loginHref = `/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <AuthCard title={<Trans>Link your account</Trans>}>
      <div className="flex flex-col gap-6">
        <p className="text-muted-foreground text-center text-sm">
          <Trans>You must be signed in to link an external account.</Trans>
        </p>

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

        <a href={loginHref} className="text-foreground text-center text-sm underline">
          <Trans>Sign in to continue</Trans>
        </a>
      </div>
    </AuthCard>
  );
}
