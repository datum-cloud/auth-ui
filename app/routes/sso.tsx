import { trustedAppOrigin } from './_shared/app-origin.server';
import { providerErrorCode } from './_shared/auth-error';
import { idpReturnUrls } from './_shared/idp-return-urls';
import { AuthCard } from '@/components/auth-card';
import { idpTypeToSlug } from '@/providers/idp-slug';
import { ProviderError } from '@/providers/types';
import type { IdProvider } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
import { readSessions, mostRecent } from '@/session/cookie';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import {
  data,
  redirect,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import type { MetaFunction } from 'react-router';
import { z } from 'zod';

export const meta: MetaFunction = () => [{ title: 'Linked accounts' }];

// ---------------------------------------------------------------------------
// Dependency-injection seam (CODE-MAJ-07). Production calls never pass deps.
// - startIdpIntent: override the provider call so tests can inject a stub.
// - onAuthEvent: collect audit events in tests without module-level mocking.
// ---------------------------------------------------------------------------

export interface SsoActionDeps {
  startIdpIntent?: (
    idpId: string,
    urls: { success: string; failure: string }
  ) => Promise<{ authUrl: string | null | undefined }>;
  onAuthEvent?: (event: string, outcome: 'success' | 'failure') => void;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);
  const organization = url.searchParams.get('organization') ?? undefined;

  const active = provider.capabilities.externalIdp
    ? await provider.getActiveIdPs(organization)
    : [];

  const entries = await readSessions(request);
  const recent = mostRecent(entries);

  // CODE-MAJ-07: guard getSession so a transient ProviderError doesn't produce a raw 500.
  // On any provider failure redirect to /login — the user must re-authenticate.
  let session: Awaited<ReturnType<typeof provider.getSession>> | null;
  try {
    session = recent ? await provider.getSession(recent.id, recent.token) : null;
  } catch (err) {
    if (err instanceof ProviderError) {
      throw redirect('/error?code=service_unavailable');
    }
    throw err; // unknown → root ErrorBoundary (CCD-10)
  }
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return redirect('/login');
  }

  // CODE-MIN-03: listIdpLinks now returns IdpLink[] — no cast needed.
  const links = await provider.listIdpLinks(userId);
  const linkedIds = new Set(links.map((l) => l.idpId));

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data(
    {
      csrfToken,
      userId,
      loginName: session?.user?.loginName ?? null,
      linked: links,
      unlinked: active.filter((p) => !linkedIds.has(p.id)),
      allowUnlink: process.env.ALLOW_IDP_UNLINK === 'true',
    },
    { headers }
  );
}

// ---------------------------------------------------------------------------
// Action schema
// ---------------------------------------------------------------------------

const SsoActionSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('unlink'),
    idpId: z.string().min(1),
    linkedUserId: z.string().min(1),
    // NOTE: any form `userId` is intentionally NOT read here — the user id comes
    // from the session only (security control).
  }),
  z.object({
    intent: z.literal('start'),
    provider: z.string().min(1),
    organization: z.string().optional(),
    linkOnly: z.string().optional(),
  }),
]);

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs, deps: SsoActionDeps = {}) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = SsoActionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return new Response('Bad Request', { status: 400 });
  const payload = parsed.data;

  if (payload.intent === 'unlink') {
    if (process.env.ALLOW_IDP_UNLINK !== 'true') return null;

    const entries = await readSessions(request);
    const recent = mostRecent(entries);
    const session = recent ? await provider.getSession(recent.id, recent.token) : null;
    const userId = session?.user?.id;
    if (!userId) return null; // never trust a form userId

    // CODE-MAJ-07: guard removeIdpLink — on ProviderError return a 502 + failure event.
    try {
      await provider.removeIdpLink(userId, payload.idpId, payload.linkedUserId);
      logAuthEvent('idp.unlink', 'success', {
        userId,
        idpId: payload.idpId,
        linkedUserId: payload.linkedUserId,
      });
    } catch (err) {
      if (err instanceof ProviderError) {
        logAuthEvent('idp.unlink', 'failure', { userId, reason: err.code });
        return data({ error: 'provider_error' }, { status: 502 });
      }
      throw err; // unknown → root ErrorBoundary (CCD-10)
    }
    return redirect('/sso');
  }

  // intent === 'start'
  const activeIdPs = await provider.getActiveIdPs(payload.organization || undefined);
  const target = activeIdPs.find(
    (p) => p.id === payload.provider || slugify(p.name) === payload.provider
  );
  if (!target) return redirect('/sso');

  // P6 Task 9: LDAP-type IdPs use a dedicated credential-entry screen instead of
  // an external IdP redirect. Route to /sso/ldap with the idpId and any flow params.
  if (idpTypeToSlug(target.type) === 'ldap') {
    // Account-linking via LDAP is not yet supported — guard it here so the user
    // gets a clear error rather than a silent plain sign-in.
    // TODO(P7): wire LDAP link via retrieveIdpIntent information + addIdpLink
    if (payload.linkOnly === 'true') {
      return redirect(`/sso/ldap/error?reason=ldap-link-unsupported`);
    }

    const qs = new URLSearchParams({ idpId: target.id });
    if (payload.organization) qs.set('organization', payload.organization);
    return redirect(`/sso/ldap?${qs.toString()}`);
  }

  const origin = trustedAppOrigin(request);
  const slug = payload.provider;
  const { success, failure } = idpReturnUrls(origin, slug, {
    link: payload.linkOnly === 'true',
    organization: payload.organization || undefined,
  });

  // CODE-MAJ-07: guard startIdpIntent — on ProviderError redirect to the SSO error page
  // and emit a failure audit event. DI seam allows tests to stub the call directly.
  const doStartIdpIntent =
    deps.startIdpIntent ??
    ((idpId: string, urls: { success: string; failure: string }) =>
      provider.startIdpIntent(idpId, urls));

  let authUrl: string | null | undefined;
  try {
    const result = await doStartIdpIntent(target.id, { success, failure });
    authUrl = result.authUrl;
  } catch (err) {
    if (err instanceof ProviderError) {
      deps.onAuthEvent?.('idp_start', 'failure');
      logAuthEvent('idp_start', 'failure', { reason: err.code });
      return redirect(`/sso/${slug}/error?reason=${providerErrorCode(err.code)}`);
    }
    throw err; // unknown → root ErrorBoundary (CCD-10)
  }

  if (!authUrl) {
    logAuthEvent('idp_start', 'failure', { reason: 'no_auth_url' });
    return redirect('/sso');
  }
  return redirect(authUrl);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SsoPage() {
  const { csrfToken, loginName, linked, unlinked, allowUnlink } = useLoaderData<typeof loader>();

  return (
    <AuthCard title={<Trans>Linked accounts</Trans>}>
      <div className="flex flex-col gap-6">
        {loginName ? <p className="text-foreground text-center text-sm">{loginName}</p> : null}

        {/* Linked IdPs */}
        {linked.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-foreground text-sm font-medium">
              <Trans>Connected accounts</Trans>
            </h2>
            <ul className="flex flex-col gap-2">
              {linked.map((link) => (
                <li
                  key={`${link.idpId}-${link.idpUserId}`}
                  className="flex items-center justify-between gap-3">
                  <span className="text-foreground text-sm">{link.idpUserName || link.idpId}</span>
                  {allowUnlink ? (
                    <form method="post">
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="intent" value="unlink" />
                      <input type="hidden" name="idpId" value={link.idpId} />
                      <input type="hidden" name="linkedUserId" value={link.idpUserId} />
                      <Button type="secondary" theme="outline" htmlType="submit" size="small">
                        <Trans>Unlink</Trans>
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Unlinked / available IdPs */}
        {unlinked.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-foreground text-sm font-medium">
              <Trans>Available accounts to link</Trans>
            </h2>
            <ul className="flex flex-col gap-2">
              {unlinked.map((idp: IdProvider) => (
                <li key={idp.id}>
                  <form method="post">
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="intent" value="start" />
                    <input type="hidden" name="provider" value={slugify(idp.name)} />
                    <input type="hidden" name="linkOnly" value="true" />
                    <Button type="primary" theme="solid" htmlType="submit" block>
                      {idp.name}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Sign-out link */}
        <form method="post" action="/id/logout">
          <input type="hidden" name="csrf" value={csrfToken} />
          <Button type="secondary" theme="outline" htmlType="submit" block>
            <Trans>Sign out</Trans>
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
