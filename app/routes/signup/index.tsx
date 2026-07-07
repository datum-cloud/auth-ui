import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { IdpButtonList } from '@/components/auth-form/idp-button-list';
import { OrDivider } from '@/components/auth-form/or-divider';
import { FormError } from '@/components/form-error/form-error';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import SplitLayout from '@/layouts/split.layout';
import { MaxMindTracker, readMaxMindTrackingToken } from '@/modules/fraud/maxmind-tracker';
import { startIdpIntent } from '@/resources/login';
import { loginIdpSchema } from '@/resources/login/login.schema';
import { resolveOrg } from '@/resources/shared/resolve-org';
import {
  decideAfterSignupIdentifier,
  decideSignupIdpIntent,
} from '@/resources/signup/signup-decision';
import { resolveSignupView } from '@/resources/signup/signup-view';
import { signupIdentifierSchema } from '@/resources/signup/signup.schema';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { requireEmailVerification } from '@/server/env';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { actionError } from '@/utils/errors/auth-error';
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

  // Org-first: an explicit org wins, else the default org (old app's `organization ?? getDefaultOrg()`).
  // The IdP list is a display read — like getLoginSettings/getBranding it uses the default-org
  // fallback, not the raw URL org (which is undefined on a bare signup).
  const settingsOrg = await resolveOrg(provider, organization);
  const [settings, branding, idps] = await Promise.all([
    provider.getLoginSettings(settingsOrg),
    provider.getBranding(settingsOrg),
    provider.capabilities.externalIdp ? provider.getActiveIdPs(settingsOrg) : Promise.resolve([]),
  ]);

  const { csrfToken, headers } = await loaderCsrf(request);

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

  const view = resolveSignupView(
    settings,
    idps,
    env.AUTH_EMAIL_DELIVERY_ENABLED,
    requireEmailVerification()
  );

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
    const { idpId, requestId, organization, deviceTrackingToken } = parsed.data;
    try {
      const result = await startIdpIntent(provider, {
        idpId,
        origin: trustedAppOrigin(request),
        requestId,
        organization,
        deviceTrackingToken,
      });
      // The pure decider maps the service result onto the Decision union.
      const decision = decideSignupIdpIntent(result);
      switch (decision.kind) {
        case 'redirect':
          return redirect(decision.path);
        case 'error':
          return data({ error: decision.error }, { status: 502 });
      }
    } catch (err) {
      return actionError(err);
    }
  }

  // Identifier flow: collect email, parse name, forward to /signup/method.
  const parsed = signupIdentifierSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const { email, organization, requestId, deviceTrackingToken } = parsed.data;
  const decision = decideAfterSignupIdentifier({
    email,
    organization,
    requestId,
    deviceTrackingToken,
  });
  // The identifier branch only ever produces a redirect (parseNameFromEmail can't fail);
  // switch exhaustively so a future error variant can't silently fall through.
  switch (decision.kind) {
    case 'redirect':
      return redirect(paths.signup.method(decision.params));
    case 'error':
      return data({ error: decision.error }, { status: 400 });
  }
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

  // The action error surfaces INLINE via <FormError> (this replaces
  // the per-route toast); useAuthActionError owns the narrow→resolve pipeline.
  const errorMessage = useAuthActionError(actionData);

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

        {view.signupUnavailable ? (
          <p className="text-foreground text-center text-sm">
            <Trans>Registration is currently unavailable. Please contact your administrator.</Trans>
          </p>
        ) : (
          <>
            {view.showIdpButtons ? (
              <IdpButtonList
                idps={idps}
                csrf={csrfToken}
                requestId={requestId}
                organization={organization}
                submittingIdpId={submittingIdpId}
              />
            ) : null}

            {view.showIdpButtons && view.allowEmailEntry ? <OrDivider /> : null}

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
                    className="flex w-full flex-col gap-4">
                    <AuthFormFields
                      csrf={csrfToken}
                      requestId={requestId}
                      organization={organization}
                    />
                    {/* deviceTrackingToken is populated client-side via ref (MaxMind mirror),
                        so it stays a route-local ref'd input outside the AuthFormFields cluster. */}
                    <input
                      type="hidden"
                      name="deviceTrackingToken"
                      ref={deviceTokenRef}
                      defaultValue=""
                    />
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
          <Link to={paths.login.index({ requestId, organization })} className="underline">
            <Trans>Sign in</Trans>
          </Link>
        </p>
      </SplitLayout>
    </>
  );
}
