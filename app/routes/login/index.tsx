import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import SplitLayout from '@/layouts/split.layout';
// ADAPTATION (plan-drift fix): readSessions + serializeSessions live in @/modules/auth/session/cookie.
// The locked plan block incorrectly listed them as coming from @/modules/auth/session/session
// (that module only has pure helpers, no cookie I/O).
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { readLastUsedLogin } from '@/modules/auth/session/last-used-login';
import { shouldBridgeToAuthorize, startIdpIntent, resolveIdentifier } from '@/resources/login';
import { resolveLoginView, resolveIdentifierField } from '@/resources/login/login-view';
import {
  loginIdentifierSchema,
  loginIdpSchema,
  isPhoneLike,
  makeLoginIdentifierClientSchema,
} from '@/resources/login/login.schema';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { getOrCreateFingerprintId, userAgentFromRequest } from '@/server/user-agent';
import { assetUrl } from '@/utils/asset-url';
import { Badge } from '@datum-cloud/datum-ui/badge';
import { Button, LinkButton } from '@datum-cloud/datum-ui/button';
import { Form } from '@datum-cloud/datum-ui/form';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { cn } from '@datum-cloud/datum-ui/utils';
import { Trans, useLingui } from '@lingui/react/macro';
import { Mail, UserKey } from 'lucide-react';
import { useState } from 'react';
import {
  data,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import {
  Form as RRForm,
  Link,
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
    return redirect(`${paths.authorize()}${url.search}`);
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
  const notice = url.searchParams.get('notice') ?? undefined;
  const lastUsedLogin = await readLastUsedLogin(request);
  return data(
    {
      settings,
      branding,
      csrfToken,
      idps,
      emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
      notice,
      lastUsedLogin,
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

  // Email-link branch — resolve the user + create the ceremony session, then redirect
  // to /login/verify/email which dispatches the OTP email on arrival.
  if (form.get('intent') === 'email-link') {
    if (!env.AUTH_EMAIL_DELIVERY_ENABLED) return data({ error: 'INVALID_INPUT' }, { status: 400 });
    const parsed = loginIdentifierSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' }, { status: 400 });
    const { loginName, requestId, organization } = parsed.data;
    const list = await readSessions(request);
    // Mint+persist the fingerprintId when absent and feed the SAME id into the
    // ceremony session's userAgent (no first-session gap). fpCookie is null when the
    // browser already carries the cookie (reuse).
    const [fingerprintId, fpCookie] = getOrCreateFingerprintId(request);
    const result = await resolveIdentifier(provider, list, {
      loginName,
      requestId,
      organization,
      emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
      userAgent: userAgentFromRequest(request, fingerprintId),
    });
    if (!result.ok) {
      // EMAIL_LOGIN_DISABLED is a true client-input rejection (400). USER_NOT_FOUND is a
      // HANDLED, inline-rendered outcome — return it as normal action data with a 200 so the
      // RR single-fetch (/login.data?index) does NOT surface a 404 the browser console-errors
      // on. The inline <FormError> still renders from `data.error`. (F1)
      if (result.error === 'EMAIL_LOGIN_DISABLED') {
        return data({ error: result.error }, { status: 400 });
      }
      return data({ error: result.error });
    }
    const verifyParams = new URLSearchParams(result.params);
    const headers = new Headers();
    headers.append('set-cookie', await serializeSessions(result.sessions));
    if (fpCookie) headers.append('set-cookie', fpCookie);
    return redirect(`${paths.login.verify.email()}?${verifyParams.toString()}`, { headers });
  }

  // Identifier flow.
  const parsed = loginIdentifierSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' }, { status: 400 });
  const { loginName, requestId, organization } = parsed.data;

  // Strict phone rejection (server-side) when the org disables phone login.
  const settings = await provider.getLoginSettings(organization);
  if (resolveIdentifierField(settings).rejectPhone && isPhoneLike(loginName)) {
    return data({ error: 'PHONE_LOGIN_DISABLED' }, { status: 400 });
  }

  const list = await readSessions(request);
  // Mint+persist the fingerprintId when absent and feed the SAME id into the
  // ceremony session's userAgent (no first-session gap). fpCookie is null on reuse.
  const [fingerprintId, fpCookie] = getOrCreateFingerprintId(request);
  const result = await resolveIdentifier(provider, list, {
    loginName,
    requestId,
    organization,
    emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
    userAgent: userAgentFromRequest(request, fingerprintId),
    // Thread the settings already fetched above (for the phone gate)
    // so resolveIdentifier skips its inner re-fetch on the known-user happy path.
    settings,
  });
  if (!result.ok) {
    // EMAIL_LOGIN_DISABLED is a true client-input rejection (400). USER_NOT_FOUND is a
    // HANDLED, inline-rendered outcome — return it as normal action data with a 200 so the
    // RR single-fetch (/login.data?index) does NOT surface a 404 the browser console-errors
    // on. The inline <FormError> still renders from `data.error`. (F1)
    if (result.error === 'EMAIL_LOGIN_DISABLED') {
      return data({ error: result.error }, { status: 400 });
    }
    return data({ error: result.error });
  }

  const headers = new Headers();
  headers.append('set-cookie', await serializeSessions(result.sessions));
  if (fpCookie) headers.append('set-cookie', fpCookie);
  return redirect(`${result.target}?${result.params}`, { headers });
}

export default function Login() {
  const { csrfToken, idps, settings, branding, emailDeliveryEnabled, notice, lastUsedLogin } =
    useLoaderData<typeof loader>();
  // RR7 infers the parent-layout loader return through the generic — the `as` cast is gone.
  // The `?? { loginName: '' }` only satisfies the structurally-possible-undefined branch; these
  // routes always render under the `login` layout, so it is never taken at runtime.
  const { loginName, requestId, organization } = useRouteLoaderData<
    typeof import('@/routes/login/layout').loader
  >('login') ?? { loginName: '' };
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  // The action error surfaces INLINE through <FormError> (this replaces the per-route
  // toast). /login renders in the visual harness, so this is the intended re-baseline
  // (toast → inline). AuthCeremony is NOT used here:
  // /login is the full SplitLayout welcome page (multi-method chooser), not an AuthCard
  // ceremony screen, so we mount the same inline FormError surface AuthCeremony owns.
  const errorMessage = useAuthActionError(actionData);

  const view = resolveLoginView(settings, idps, emailDeliveryEnabled);

  const field = resolveIdentifierField(settings);
  const identifierLabel = field.allowEmail
    ? field.allowPhone
      ? t`Email, phone, or username`
      : t`Email`
    : field.allowPhone
      ? t`Phone`
      : t`Username`;
  const identifierPlaceholder = field.allowEmail
    ? 'email@example.com'
    : field.allowPhone
      ? '+1 555 000 0000'
      : 'username';
  const identifierClientSchema = makeLoginIdentifierClientSchema({
    rejectPhone: field.rejectPhone,
  });

  const submittingIdpId =
    navigation.state !== 'idle' && navigation.formData?.get('intent') === 'idp'
      ? String(navigation.formData.get('idpId') ?? '')
      : null;
  const identifierSubmitting =
    navigation.state === 'submitting' && navigation.formData?.get('intent') !== 'idp';

  // Typed paths.* emit the identical query string the hand-built URLSearchParams
  // produced (insertion order requestId → organization; undefined values skipped).
  const signupHref = paths.signup.index({ requestId, organization });

  // Passkey-first prompt (P2): link to the existing /login/passkey webauthn flow,
  // carrying any known loginName + the ceremony context. /login/passkey redirects
  // back gracefully when there is no resolvable session, so this is safe cold too.
  // Empty loginName ('') is skipped (treated as absent) to preserve the prior URL.
  const passkeyHref = paths.login.passkey({
    loginName: loginName || undefined,
    requestId,
    organization,
  });

  const [showEmailField, setShowEmailField] = useState(false);

  return (
    <SplitLayout branding={branding}>
      <div className="mb-8 flex flex-col gap-3">
        <h1 className="text-foreground text-2xl leading-6 font-semibold">
          <Trans>Welcome</Trans>
        </h1>
        <p className="text-foreground/80 text-sm">
          <Trans>Choose your login method</Trans>
        </p>
        {notice === 'link-existing' ? (
          <p role="status" className="text-destructive mb-4 text-sm">
            <Trans>An account with this email already exists — sign in to continue.</Trans>
          </p>
        ) : null}
        {/* Inline action-error surface (role="alert" + aria-live) — replaces the
            per-route toast. Renders nothing when there is no error. */}
        <FormError>{errorMessage}</FormError>
      </div>

      {view.showIdpButtons ? (
        <div className="flex flex-col gap-3">
          {idps.map((idp) => (
            <RRForm key={idp.id} method="post">
              <AuthFormFields csrf={csrfToken} requestId={requestId} organization={organization} />
              <input type="hidden" name="intent" value="idp" />
              <input type="hidden" name="idpId" value={idp.id} />
              <Button
                size="large"
                className="relative h-13 gap-3"
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
                {lastUsedLogin === `idp:${idp.id}` ? (
                  <Badge
                    type="primary"
                    theme="solid"
                    className="absolute -top-3.5 -right-5 rounded-lg text-xs text-white dark:text-[#0c1d31]">
                    <Trans>Last used</Trans>
                  </Badge>
                ) : null}
              </Button>
            </RRForm>
          ))}
        </div>
      ) : null}

      {view.showPasskeyPrompt ? (
        <LinkButton
          size="large"
          className={cn('relative h-13 gap-3', view.showIdpButtons && 'mt-3')}
          type="quaternary"
          theme="outline"
          block
          as={Link}
          href={passkeyHref}
          iconPosition="left"
          icon={<Icon icon={UserKey} />}>
          <Trans>Passkey</Trans>
          {lastUsedLogin === 'passkey' ? (
            <Badge
              type="primary"
              theme="solid"
              className="absolute -top-3.5 -right-5 rounded-lg text-xs text-white dark:text-[#0c1d31]">
              <Trans>Last used</Trans>
            </Badge>
          ) : null}
        </LinkButton>
      ) : null}

      {view.showPasswordForm && view.showIdpButtons ? (
        <div className="relative my-8 flex items-center" aria-hidden="true">
          <div className="border-border flex-grow border-t" />
          <span className="text-foreground/60 mx-3 shrink-0 text-xs">
            <Trans>or</Trans>
          </span>
          <div className="border-border flex-grow border-t" />
        </div>
      ) : null}

      {view.showPasswordForm ? (
        <>
          {!showEmailField ? (
            <Button
              size="large"
              className="relative h-13 gap-3"
              type="quaternary"
              theme="outline"
              block
              iconPosition="left"
              icon={<Icon icon={Mail} />}
              onClick={() => setShowEmailField(true)}>
              <Trans>Email</Trans>
              {lastUsedLogin === 'email' ? (
                <Badge
                  type="primary"
                  theme="solid"
                  className="absolute -top-3.5 -right-5 rounded-lg text-xs text-white dark:text-[#0c1d31]">
                  <Trans>Last used</Trans>
                </Badge>
              ) : null}
            </Button>
          ) : (
            <Form.Root
              schema={identifierClientSchema}
              formComponent={RRForm}
              method="POST"
              defaultValues={{ loginName: loginName ?? '' }}
              isSubmitting={navigation.state === 'submitting'}
              className="flex w-full flex-col gap-4">
              <AuthFormFields csrf={csrfToken} requestId={requestId} organization={organization} />
              <Form.Field
                name="loginName"
                label={identifierLabel}
                required
                labelClassName="text-xs"
                className="mb-0">
                <Form.Input
                  type="text"
                  autoFocus
                  autoComplete="username"
                  placeholder={identifierPlaceholder}
                  className="h-9"
                />
              </Form.Field>
              <SubmitButton loading={identifierSubmitting}>
                <Trans>Continue</Trans>
              </SubmitButton>
              {view.showEmailLink ? (
                <button
                  type="submit"
                  name="intent"
                  value="email-link"
                  className="text-foreground/70 hover:text-foreground mt-1 w-full text-center text-sm underline underline-offset-2 transition-colors"
                  disabled={navigation.state !== 'idle'}>
                  <Trans>Email me a sign-in link</Trans>
                </button>
              ) : null}
            </Form.Root>
          )}
        </>
      ) : null}

      {view.signInUnavailable ? (
        <p className="text-foreground text-center text-sm">
          <Trans>
            Sign-in is currently unavailable for this account. Please contact your administrator.
          </Trans>
        </p>
      ) : null}

      {view.showRegisterLink ? (
        <>
          <div className="border-border my-8 flex-grow border-t" />
          <p className="text-foreground/80 text-center text-sm">
            <Trans>Not registered?</Trans>{' '}
            <Link to={signupHref} className="underline">
              <Trans>Create account</Trans>
            </Link>
          </p>
        </>
      ) : null}
    </SplitLayout>
  );
}
