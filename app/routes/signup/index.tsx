import { SubmitButton } from '@/components/auth-form/auth-form';
import { FormError } from '@/components/form-error/form-error';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import SplitLayout from '@/layouts/split.layout';
import { MaxMindTracker, readMaxMindTrackingToken } from '@/modules/fraud/maxmind-tracker';
import { startIdpIntent } from '@/resources/login';
import { loginIdpSchema } from '@/resources/login/login.schema';
import { parseNameFromEmail } from '@/resources/signup/parse-name';
import { resolveSignupView } from '@/resources/signup/signup-view';
import { signupIdentifierSchema } from '@/resources/signup/signup.schema';
import { trustedAppOrigin } from '@/server/app-origin.server';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { assetUrl } from '@/utils/asset-url';
import { env } from '@/utils/env/env.server';
import { actionError } from '@/utils/errors/auth-error';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
import { Button } from '@datum-cloud/datum-ui/button';
import { Form } from '@datum-cloud/datum-ui/form';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans, useLingui } from '@lingui/react/macro';
import { Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  data,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm, Link, useLoaderData, useActionData, useNavigation } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Create account' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);
  const organization = url.searchParams.get('organization') ?? undefined;
  const requestId = url.searchParams.get('requestId') ?? undefined;

  const [settings, branding, idps] = await Promise.all([
    provider.getLoginSettings(organization),
    provider.getBranding(organization),
    provider.capabilities.externalIdp ? provider.getActiveIdPs(organization) : Promise.resolve([]),
  ]);

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  // Phase 4 register-and-link: the IdP callback (/sso/:provider/callback) redirects a brand-new
  // IdP user here with the intent + draft so this screen can compose register → addIdpLink → createSession.
  // Keep this prefill so the downstream /signup/method can pick it up when needed.
  const idpIntentId = url.searchParams.get('idpIntentId') ?? undefined;
  const idp = idpIntentId
    ? {
        idpIntentId,
        idpIntentToken: url.searchParams.get('idpIntentToken') ?? '',
        idpId: url.searchParams.get('idpId') ?? '',
        idpUserId: url.searchParams.get('idpUserId') ?? '',
        idpUserName: url.searchParams.get('idpUserName') ?? '',
      }
    : undefined;

  const prefill = {
    email: url.searchParams.get('email') ?? '',
  };

  const view = resolveSignupView(settings, idps, env.AUTH_EMAIL_DELIVERY_ENABLED);

  return data(
    {
      csrfToken,
      branding,
      view,
      idps,
      organization,
      requestId,
      maxmindAccountId: env.MAXMIND_ACCOUNT_ID ?? '',
      prefill,
      idp,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  // IdP intent branch — user clicked an IdP button.
  if (form.get('intent') === 'idp') {
    const parsed = loginIdpSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
    const { idpId, requestId, organization } = parsed.data;
    try {
      const result = await startIdpIntent(provider, {
        idpId,
        origin: trustedAppOrigin(request),
        requestId,
        organization,
      });
      if (!result.ok) return data({ error: result.error }, { status: 502 });
      return redirect(result.authUrl);
    } catch (err) {
      return actionError(err);
    }
  }

  // Identifier flow: collect email, parse name, forward to /signup/method.
  const parsed = signupIdentifierSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const { email, organization, requestId, deviceTrackingToken } = parsed.data;
  const { firstName, lastName } = parseNameFromEmail(email);

  const params = new URLSearchParams({ loginName: email, firstName, lastName });
  if (organization) params.set('organization', organization);
  if (requestId) params.set('requestId', requestId);
  if (deviceTrackingToken) params.set('deviceTrackingToken', deviceTrackingToken);

  return redirect(`/signup/method?${params.toString()}`);
}

export default function Signup() {
  const { csrfToken, branding, view, idps, organization, requestId, maxmindAccountId, prefill } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const deviceTokenRef = useRef<HTMLInputElement>(null);

  // Keep the hidden deviceTrackingToken input populated from the token the
  // MaxMindTracker mirrors into sessionStorage. The token may land a moment after
  // mount, so re-read on a short interval until it appears (or the field unmounts).
  useEffect(() => {
    if (!maxmindAccountId) return;
    const sync = () => {
      const token = readMaxMindTrackingToken();
      if (token && deviceTokenRef.current) {
        deviceTokenRef.current.value = token;
        return true;
      }
      return false;
    };
    if (sync()) return;
    const handle = window.setInterval(() => {
      if (sync()) window.clearInterval(handle);
    }, 300);
    return () => window.clearInterval(handle);
  }, [maxmindAccountId]);

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

  const submittingIdpId =
    navigation.state !== 'idle' && navigation.formData?.get('intent') === 'idp'
      ? String(navigation.formData.get('idpId') ?? '')
      : null;

  const identifierSubmitting =
    navigation.state === 'submitting' && navigation.formData?.get('intent') !== 'idp';

  const [showEmailField, setShowEmailField] = useState(false);

  // Client-side schema for the email field (advisory; server re-validates).
  const emailClientSchema = signupIdentifierSchema.pick({ email: true });

  return (
    <>
      <MaxMindTracker accountId={maxmindAccountId} />
      <SplitLayout branding={branding}>
        <div className="mb-8 flex flex-col gap-3">
          <h1 className="text-foreground text-2xl leading-6 font-semibold">
            <Trans>Get started</Trans>
          </h1>
          <p className="text-foreground/80 text-sm">
            <Trans>Create a new account</Trans>
          </p>
        </div>

        {view.registrationDisabled ? (
          <p className="text-foreground text-center text-sm">
            <Trans>Registration is currently unavailable. Please contact your administrator.</Trans>
          </p>
        ) : (
          <>
            {view.showIdpButtons ? (
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
                      size="large"
                      className="h-13 gap-3"
                      type="quaternary"
                      theme="outline"
                      block
                      htmlType="submit"
                      loading={submittingIdpId === idp.id}
                      iconPosition="left"
                      icon={
                        <img
                          src={assetUrl(
                            `/images/idps/${idp.name.toLowerCase().replace(/\s+/g, '-')}.png`
                          )}
                          alt={idp.name}
                          aria-hidden="true"
                          className="size-4 object-contain"
                        />
                      }>
                      <Trans>{idp.name}</Trans>
                    </Button>
                  </RRForm>
                ))}
              </div>
            ) : null}

            {view.showIdpButtons && view.allowEmailEntry ? (
              <div className="relative my-8 flex items-center" aria-hidden="true">
                <div className="border-border flex-grow border-t" />
                <span className="text-foreground/60 mx-3 shrink-0 text-xs">
                  <Trans>or</Trans>
                </span>
                <div className="border-border flex-grow border-t" />
              </div>
            ) : null}

            {view.allowEmailEntry ? (
              <>
                {!showEmailField ? (
                  <Button
                    size="large"
                    className="h-13 gap-3"
                    type="quaternary"
                    theme="outline"
                    block
                    iconPosition="left"
                    icon={<Icon icon={Mail} />}
                    onClick={() => setShowEmailField(true)}>
                    <Trans>Email</Trans>
                  </Button>
                ) : (
                  <Form.Root
                    schema={emailClientSchema}
                    formComponent={RRForm}
                    method="POST"
                    defaultValues={{ email: prefill.email }}
                    isSubmitting={navigation.state === 'submitting'}
                    className="flex flex-col gap-4">
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input
                      type="hidden"
                      name="deviceTrackingToken"
                      ref={deviceTokenRef}
                      defaultValue=""
                    />
                    {organization ? (
                      <input type="hidden" name="organization" value={organization} />
                    ) : null}
                    {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
                    <Form.Field
                      name="email"
                      label={t`Email`}
                      required
                      labelClassName="text-xs"
                      className="mb-0">
                      <Form.Input
                        type="email"
                        autoFocus
                        autoComplete="email"
                        placeholder="email@example.com"
                        className="h-9"
                      />
                    </Form.Field>
                    <FormError>{errorMessage}</FormError>
                    <SubmitButton loading={identifierSubmitting}>
                      <Trans>Continue</Trans>
                    </SubmitButton>
                  </Form.Root>
                )}
              </>
            ) : null}

            {!view.allowEmailEntry && view.showIdpButtons ? (
              <FormError>{errorMessage}</FormError>
            ) : null}
          </>
        )}

        <div className="border-border my-8 flex-grow border-t" />
        <p className="text-foreground/80 text-center text-sm">
          <Trans>Already have an account?</Trans>{' '}
          <Link
            to={
              organization || requestId
                ? `/login?${new URLSearchParams({ ...(requestId ? { requestId } : {}), ...(organization ? { organization } : {}) }).toString()}`
                : '/login'
            }
            className="underline">
            <Trans>Sign in</Trans>
          </Link>
        </p>
      </SplitLayout>
    </>
  );
}
