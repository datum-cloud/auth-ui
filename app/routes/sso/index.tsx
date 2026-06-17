import { AuthCard } from '@/components/auth-card/auth-card';
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
                    // RRForm auto-adds ?index → POST reaches the sso index action.
                    <RRForm method="post">
                      <input type="hidden" name="csrf" value={csrfToken} />
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
                    <input type="hidden" name="csrf" value={csrfToken} />
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
          <input type="hidden" name="csrf" value={csrfToken} />
          <Button type="secondary" theme="outline" htmlType="submit" block>
            <Trans>Sign out</Trans>
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
