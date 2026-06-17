import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
// ADAPTATION (plan-drift fix): readSessions + serializeSessions live in @/modules/auth/session/cookie.
// The locked plan block incorrectly listed them as coming from @/modules/auth/session/session
// (that module only has pure helpers, no cookie I/O).
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { shouldBridgeToAuthorize, startIdpIntent, resolveIdentifier } from '@/resources/login';
import {
  loginIdentifierSchema,
  loginIdpSchema,
  loginIdentifierClientSchema,
} from '@/resources/login/login.schema';
import { shouldShowIdpButtons } from '@/resources/sso/idp-buttons';
import { type LoginLayoutData } from '@/routes/login/layout';
import { trustedAppOrigin } from '@/server/app-origin.server';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
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
import {
  Form as RRForm,
  useLoaderData,
  useActionData,
  useNavigation,
  useRouteLoaderData,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Sign in' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);

  // Bridge raw login-v2 protocol entries (?authRequest=/?samlRequest=) to /authorize.
  // The post-identifier ?requestId= return never re-triggers this (no loop).
  if (shouldBridgeToAuthorize(url.searchParams)) {
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
    const parsed = loginIdpSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' }, { status: 400 });
    const { idpId, requestId, organization } = parsed.data;
    const result = await startIdpIntent(provider, {
      idpId,
      origin: trustedAppOrigin(request),
      requestId,
      organization,
    });
    if (!result.ok) return data({ error: result.error }, { status: 502 });
    // The authUrl is the provider's IdP-start URL; requestId + organization are threaded
    // via the IdP success URL (built inside the service), not here.
    return redirect(result.authUrl);
  }

  // Identifier flow.
  const parsed = loginIdentifierSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' }, { status: 400 });
  const { loginName, requestId, organization } = parsed.data;

  const list = await readSessions(request);
  const result = await resolveIdentifier(provider, list, { loginName, requestId, organization });
  if (!result.ok) return data({ error: result.error }, { status: 404 });

  return redirect(`${result.target}?${result.params}`, {
    headers: { 'set-cookie': await serializeSessions(result.sessions) },
  });
}

export default function Login() {
  const { csrfToken, idps } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useRouteLoaderData('login') as LoginLayoutData;
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
        schema={loginIdentifierClientSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ loginName: loginName ?? '' }}
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
