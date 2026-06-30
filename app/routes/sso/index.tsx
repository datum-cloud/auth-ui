import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { IdpIcon } from '@/components/idp-icon/idp-icon';
import { inferIdpType } from '@/modules/auth/idp-detect';
import { slugify } from '@/modules/auth/idp-slug';
import type { IdProvider } from '@/modules/auth/types';
import {
  resolveSsoManagement,
  runSsoAction,
  outcomeToResponse,
  type SsoActionDeps,
} from '@/resources/sso';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { Button } from '@datum-cloud/datum-ui/button';
import { Separator } from '@datum-cloud/datum-ui/separator';
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
// Component
// ---------------------------------------------------------------------------

export default function SsoPage() {
  const { csrfToken, loginName, linked, linkable, allowUnlink } = useLoaderData<typeof loader>();

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
                  className="flex h-13 items-center justify-between gap-3 rounded-md border px-4">
                  {/* Provider icon + name badge (joined from the active-IdP list).
                      Falls back to the bare IdP user name / id when the provider is no longer
                      active. Icon is non-interactive — no nested-interactive a11y violation. */}
                  <span className="flex min-w-0 items-center gap-3">
                    {/* `type` is only joined in when the IdP is still active; for a deactivated
                        provider it's undefined and the bare GitHub handle would fall back to the
                        mail glyph. inferIdpType recovers GITHUB from the username shape. */}
                    <IdpIcon
                      type={link.type ?? inferIdpType(link.idpUserName)}
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

        {/* Divider between the connected list and the available-to-link list — only
            when both are present so a single-section page has no dangling rule. */}
        {linked.length > 0 && linkable.length > 0 ? <Separator /> : null}

        {/* Unlinked / available IdPs */}
        {linkable.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-foreground text-sm font-medium">
              <Trans>Available accounts to link</Trans>
            </h2>
            <ul className="flex flex-col gap-2">
              {linkable.map((idp: IdProvider) => (
                <li key={idp.id}>
                  {/* RRForm: auto-adds ?index → posts to the sso index action. */}
                  <RRForm method="post">
                    <AuthFormFields csrf={csrfToken} />
                    <input type="hidden" name="intent" value="start" />
                    <input type="hidden" name="provider" value={slugify(idp.name)} />
                    <input type="hidden" name="linkOnly" value="true" />
                    {/* Mirrors the setup/mfa.tsx enrollment rows: large outline row with the
                        provider icon on the left. These are real form submits (start the link
                        flow), so it stays a <Button htmlType="submit"> — not a LinkButton/<a>.
                        IdpIcon is decorative (aria-hidden); the accessible name is idp.name. */}
                    <Button
                      size="large"
                      className="h-13 gap-3"
                      type="quaternary"
                      theme="outline"
                      block
                      iconPosition="left"
                      icon={<IdpIcon type={idp.type} name={idp.name} logoUrl={idp.logoUrl} />}
                      htmlType="submit">
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
          <Button type="secondary" theme="link" htmlType="submit" block>
            <Trans>Sign out</Trans>
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
