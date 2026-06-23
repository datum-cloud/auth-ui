import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import type { IdProvider } from '@/modules/auth/types';
import {
  resolveSsoManagement,
  runSsoAction,
  outcomeToResponse,
  type SsoActionDeps,
} from '@/resources/sso';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { assetUrl } from '@/utils/asset-url';
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
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Linked accounts' }];

export type { SsoActionDeps };

// ---------------------------------------------------------------------------
// Loader — parse request → resolveSsoManagement → render data / redirect.
// CSRF token minting stays at the route boundary; business logic lives in the service.
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const [csrfToken, setCookie] = await getCsrfToken(request);

  const result = await resolveSsoManagement(provider, request, { token: csrfToken, setCookie });
  if (result.kind === 'redirect') return redirect(result.location);

  const headers: Record<string, string> = {};
  if (result.setCookie !== null) headers['set-cookie'] = result.setCookie;
  return data(result.data, { headers });
}

// ---------------------------------------------------------------------------
// Action — assert CSRF → runSsoAction → translate the typed outcome.
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs, deps: SsoActionDeps = {}) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  // `null` route returns (unlink guards) are encoded as an empty 200 Response; preserve them.
  const outcome = await runSsoAction(provider, request, form, deps);
  if (outcome.kind === 'response' && outcome.response.status === 200) return null;
  return outcomeToResponse(outcome);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

// 755-M6: provider icon/name badge for a linked IdP. Ports the OLD linked-idp-list switch
// (on the IdP type) to the rebuilt string-typed `type` ('GOOGLE' | 'GITHUB' | 'GITHUB_ES' | …
// from toIdProvider). Resolution order: known-type SVG → provider logoUrl → name initials.
// Non-interactive (plain <img>/<span>) so it never nests inside the row's unlink <button>.
function IdpIcon({ type, name, logoUrl }: { type?: string; name?: string; logoUrl?: string }) {
  const t = (type ?? '').toUpperCase();
  if (t === 'GOOGLE') {
    return (
      <img
        src={assetUrl(`/images/idps/google.png`)}
        alt=""
        aria-hidden
        width={20}
        height={20}
        className="rounded"
      />
    );
  }
  if (t === 'GITHUB' || t === 'GITHUB_ES') {
    return (
      <img
        src={assetUrl(`/images/idps/github.png`)}
        alt=""
        aria-hidden
        width={20}
        height={20}
        className="rounded"
      />
    );
  }
  if (logoUrl) {
    return <img src={logoUrl} alt="" aria-hidden width={20} height={20} className="rounded" />;
  }
  const initials = (name ?? '?').slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden
      className="bg-muted text-muted-foreground flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold">
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SsoPage() {
  const { csrfToken, loginName, linked, unlinked, allowUnlink } = useLoaderData<typeof loader>();

  return (
    <AuthCard
      title={<Trans>Linked accounts</Trans>}
      description={
        <Trans>
          You can link multiple accounts to your Datum account.{' '}
          {loginName && (
            <>
              Logged in as <span className="font-medium">{loginName}</span>.
            </>
          )}
        </Trans>
      }>
      <div className="flex w-full flex-col gap-4">
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
                  {/* 755-M6: provider icon + name badge (joined from the active-IdP list).
                      Falls back to the bare IdP user name / id when the provider is no longer
                      active. Icon is non-interactive — no nested-interactive a11y violation. */}
                  <span className="flex min-w-0 items-center gap-3">
                    <IdpIcon
                      type={link.type}
                      name={link.name || link.idpUserName || link.idpId}
                      logoUrl={link.logoUrl}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-foreground truncate text-sm">
                        {link.name || link.idpUserName || link.idpId}
                      </span>
                      {link.idpUserName && link.name ? (
                        <span className="text-muted-foreground truncate text-xs">
                          {link.idpUserName}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {allowUnlink ? (
                    // RRForm auto-adds ?index → POST reaches the sso index action.
                    <RRForm method="post">
                      <AuthFormFields csrf={csrfToken} />
                      <input type="hidden" name="intent" value="unlink" />
                      <input type="hidden" name="idpId" value={link.idpId} />
                      <input type="hidden" name="linkedUserId" value={link.idpUserId} />
                      <Button type="secondary" theme="outline" htmlType="submit" size="small">
                        <Trans>Unlink</Trans>
                      </Button>
                    </RRForm>
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
                  {/* RRForm: auto-adds ?index → posts to the sso index action. */}
                  <RRForm method="post">
                    <AuthFormFields csrf={csrfToken} />
                    <input type="hidden" name="intent" value="start" />
                    <input type="hidden" name="provider" value={slugify(idp.name)} />
                    <input type="hidden" name="linkOnly" value="true" />
                    <Button type="primary" theme="solid" htmlType="submit" block>
                      {idp.name}
                    </Button>
                  </RRForm>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Sign-out link → logout INDEX action; ?index disambiguates from the
            action-less logout/layout (native <form> won't add it like RR <Form> does). */}
        <form method="post" action="/id/logout?index">
          <AuthFormFields csrf={csrfToken} />
          <Button type="secondary" theme="outline" htmlType="submit" block>
            <Trans>Sign out</Trans>
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
