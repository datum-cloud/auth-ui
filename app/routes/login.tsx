import { trustedAppOrigin } from './_shared/app-origin.server';
import { idpReturnUrls } from './_shared/idp-return-urls';
import { REQUEST_ID_PATTERN } from './_shared/request-id';
import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import { shouldShowIdpButtons } from '@/flows/idp-buttons';
import { decideAfterIdentifier } from '@/flows/login-decision';
import { idpTypeToSlug } from '@/providers/idp-slug';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent, hashActor } from '@/server/observability';
// ADAPTATION (plan-drift fix): readSessions + serializeSessions live in @/session/cookie;
// addSession is re-exported from there too. The locked plan block incorrectly listed all
// three as coming from @/session/session (that module only has pure helpers, no cookie I/O).
import { readSessions, addSession, serializeSessions } from '@/session/cookie';
import { Button } from '@datum-cloud/datum-ui/button';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  data,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm, useLoaderData, useActionData, useNavigation } from 'react-router';
import { z } from 'zod';

export const meta: MetaFunction = () => [{ title: 'Sign in' }];

const schema = z.object({
  loginName: z.string().min(1).max(200),
  requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  organization: z.string().optional(),
});

const idpSchema = z.object({
  intent: z.literal('idp'),
  idpId: z.string().min(1),
  requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  organization: z.string().optional(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);

  // Zitadel's login-v2 base URI appends `/login?authRequest=…` (OIDC) or
  // `?samlRequest=…` (SAML) — NOT `/authorize`. Forward the raw protocol entry to
  // our orchestrator, which normalizes it to a requestId and threads the ceremony.
  // Keyed on authRequest/samlRequest only, so the post-identifier return from
  // /authorize (which carries ?requestId=) never re-triggers this (no loop).
  if (url.searchParams.get('authRequest') || url.searchParams.get('samlRequest')) {
    return redirect(`/authorize${url.search}`);
  }

  const organization = url.searchParams.get('organization') ?? undefined;
  const [settings, branding, idps] = await Promise.all([
    provider.getLoginSettings(organization),
    provider.getBranding(organization),
    provider.capabilities.externalIdp ? provider.getActiveIdPs(organization) : Promise.resolve([]),
  ]);
  const [csrfToken, setCookie] = await getCsrfToken(request);
  // ADAPTATION (getCsrfToken null handling): only set 'set-cookie' when non-null.
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  return data(
    {
      settings,
      branding,
      csrfToken,
      idps,
      requestId: url.searchParams.get('requestId') ?? undefined,
      organization,
      loginHint: url.searchParams.get('loginName') ?? '',
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  // /login is state-changing — verify CSRF before anything else.
  await assertCsrf(request, form);

  // IdP intent branch — must come before identifier logic.
  if (form.get('intent') === 'idp') {
    const parsed = idpSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' }, { status: 400 });
    const { idpId, requestId, organization } = parsed.data;
    const origin = trustedAppOrigin(request);
    const slug = idpTypeToSlug(idpId) ?? idpId;
    const { success, failure } = idpReturnUrls(origin, slug, { requestId, organization });
    const result = await provider.startIdpIntent(idpId, { success, failure });
    if (!result.authUrl) {
      logAuthEvent('idp_start', 'failure', { idpId, reason: 'no_auth_url' });
      return data({ error: 'IDP_UNAVAILABLE' }, { status: 502 });
    }
    logAuthEvent('idp_start', 'success', { idpId });
    // requestId + organization are threaded via the IdP success URL (idpReturnUrls above),
    // not here — they must survive the IdP round-trip and arrive at the /sso callback so it
    // can resume /authorize. The authUrl is the provider's IdP-start URL; we just follow it.
    return redirect(result.authUrl);
  }

  // Identifier flow (unchanged).
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' }, { status: 400 });
  const { loginName, requestId, organization } = parsed.data;

  const user = await provider.findUser(loginName, organization);
  if (!user) {
    logAuthEvent('identifier', 'failure', { actor: hashActor(loginName), reason: 'not_found' });
    // User not found — Phase 1 surfaces a generic message; register/ignoreUnknown handled in Phase 2.
    return data({ error: 'USER_NOT_FOUND' }, { status: 404 });
  }
  logAuthEvent('identifier', 'success', { actor: hashActor(loginName) });

  const session = await provider.createSession(
    {},
    { requestId, orgId: organization, metadata: { userId: user.id } }
  );
  const methods = await provider.listAuthMethods(user.id);
  const settings = await provider.getLoginSettings(organization);
  const decision = decideAfterIdentifier({ methods, settings });

  // Persist the ceremony session into the signed cookie.
  const list = await readSessions(request);
  const next = addSession(list, {
    id: session.id,
    token: session.token,
    loginName: user.loginName,
    organization,
    creationTs: session.changedAt,
    expirationTs: session.expiresAt,
    changeTs: session.changedAt,
    requestId,
  });
  const params = new URLSearchParams({ loginName: user.loginName });
  if (requestId) params.set('requestId', requestId);
  if (organization) params.set('organization', organization);
  Object.entries(decision.params ?? {}).forEach(([k, v]) => params.set(k, v));

  return redirect(`${decision.target}?${params}`, {
    headers: { 'set-cookie': await serializeSessions(next) },
  });
}

// client-side validation subset; advisory only (server action's schema is the real gate)
const clientSchema = z.object({ loginName: z.string().min(1) });

export default function Login() {
  const { csrfToken, requestId, organization, loginHint, idps } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const serverError =
    actionData && 'error' in actionData
      ? actionData.error === 'USER_NOT_FOUND'
        ? t`We could not find an account for that identifier.`
        : actionData.error === 'IDP_UNAVAILABLE'
          ? t`This sign-in provider is currently unavailable. Please try again later.`
          : t`Please check your input and try again.`
      : undefined;

  const showIdpButtons = shouldShowIdpButtons({ externalIdp: idps.length > 0 }, idps);

  const submittingIdpId =
    navigation.state !== 'idle' && navigation.formData?.get('intent') === 'idp'
      ? String(navigation.formData.get('idpId') ?? '')
      : null;
  const identifierSubmitting =
    navigation.state === 'submitting' && navigation.formData?.get('intent') !== 'idp';

  return (
    <AuthCard title={<Trans>Sign in</Trans>}>
      <Form.Root
        schema={clientSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ loginName: loginHint ?? '' }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
        {organization ? <input type="hidden" name="organization" value={organization} /> : null}
        <Form.Field name="loginName" label={t`Email or username`} required>
          <Form.Input
            type="text"
            autoFocus
            autoComplete="username"
            placeholder="email@example.com"
          />
        </Form.Field>
        {serverError ? (
          <p role="alert" className="text-sm text-red-700">
            {serverError}
          </p>
        ) : null}
        <SubmitButton loading={identifierSubmitting}>
          <Trans>Continue</Trans>
        </SubmitButton>
      </Form.Root>

      {showIdpButtons ? (
        <>
          <div className="relative my-4 flex items-center" aria-hidden="true">
            <div className="flex-grow border-t border-gray-200" />
            <span className="mx-3 shrink-0 text-sm text-gray-600">
              <Trans>or</Trans>
            </span>
            <div className="flex-grow border-t border-gray-200" />
          </div>

          <div className="flex flex-col gap-3">
            {idps.map((idp) => (
              <RRForm key={idp.id} method="post">
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="intent" value="idp" />
                <input type="hidden" name="idpId" value={idp.id} />
                {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
                {organization ? (
                  <input type="hidden" name="organization" value={organization} />
                ) : null}
                <Button
                  type="secondary"
                  theme="outline"
                  block
                  htmlType="submit"
                  loading={submittingIdpId === idp.id}>
                  {idp.logoUrl ? (
                    <img
                      src={idp.logoUrl}
                      alt=""
                      aria-hidden="true"
                      className="mr-2 h-5 w-5 object-contain"
                    />
                  ) : null}
                  <Trans>Continue with {idp.name}</Trans>
                </Button>
              </RRForm>
            ))}
          </div>
        </>
      ) : null}
    </AuthCard>
  );
}
