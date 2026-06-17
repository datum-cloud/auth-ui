import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { TrackOnMount } from '@/modules/analytics/fathom';
import { MaxMindTracker, readMaxMindTrackingToken } from '@/modules/fraud/maxmind-tracker';
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { genericCheckYourEmail } from '@/resources/schemas/check-your-email.schema';
import { registerAndLinkIdp, passwordFirstHandoff, registerPasskeyFirst } from '@/resources/signup';
import { registerSchema, registerClientSchema } from '@/resources/signup/signup.schema';
import { trustedAppOrigin } from '@/server/app-origin.server';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { requireEmailVerification } from '@/server/env';
import { env } from '@/utils/env/env.server';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef } from 'react';
import {
  data,
  redirect,
  useLoaderData,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Create account' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);
  const organization = url.searchParams.get('organization') ?? undefined;
  const [csrfToken, setCookie] = await getCsrfToken(request);
  const branding = await provider.getBranding(organization);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  // Phase 4 register-and-link: the IdP callback (/sso/:provider/callback) redirects a brand-new
  // IdP user here with the intent + draft so this screen composes register → addIdpLink → createSession.
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
  return data(
    {
      csrfToken,
      branding,
      organization,
      requestId: url.searchParams.get('requestId') ?? undefined,
      idp,
      prefill: {
        email: url.searchParams.get('email') ?? '',
        firstName: url.searchParams.get('firstName') ?? '',
        lastName: url.searchParams.get('lastName') ?? '',
      },
      maxmindAccountId: env.MAXMIND_ACCOUNT_ID ?? '',
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = registerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const { email, firstName, lastName, organization, requestId, deviceTrackingToken } = parsed.data;

  // Phase 4 register-and-link: if an IdP intent rode in (from /sso/:provider/callback), the
  // service composes register → addIdpLink → createSession. IdP users are passwordless — they
  // skip the /signup/password path below.
  const idpIntentId = form.get('idpIntentId');
  const idpIntentToken = form.get('idpIntentToken');
  const idpId = form.get('idpId');
  if (
    typeof idpIntentId === 'string' &&
    idpIntentId &&
    typeof idpIntentToken === 'string' &&
    idpIntentToken &&
    typeof idpId === 'string' &&
    idpId
  ) {
    const result = await registerAndLinkIdp(provider, await readSessions(request), {
      email,
      firstName,
      lastName,
      organization,
      requestId,
      idpIntentId,
      idpIntentToken,
      idpId,
      idpUserId: String(form.get('idpUserId') ?? ''),
      idpUserName: String(form.get('idpUserName') ?? ''),
    });
    return redirect(result.target, {
      headers: { 'set-cookie': await serializeSessions(result.sessions) },
    });
  }

  const settings = await provider.getLoginSettings(organization);

  if (settings.allowPassword) {
    // Password-first path: the service carries all fields to /signup/password.
    const result = passwordFirstHandoff({
      email,
      firstName,
      lastName,
      organization,
      requestId,
      deviceTrackingToken,
    });
    return redirect(result.target);
  }

  // Passkey-first path: register directly, then apply enumeration-safe handling.
  // SECURITY: trustedAppOrigin → PUBLIC_ORIGIN, never the request Host header, to
  // prevent Host-header email-link injection.
  const result = await registerPasskeyFirst(provider, await readSessions(request), {
    email,
    firstName,
    lastName,
    organization,
    requestId,
    deviceTrackingToken,
    requireVerification: requireEmailVerification(),
    origin: trustedAppOrigin(request),
  });

  if (result.kind === 'sent') return genericCheckYourEmail(result.email);
  if (result.kind === 'sent-with-session') {
    return data(
      { sent: true as const, email: result.email },
      { status: 200, headers: { 'set-cookie': await serializeSessions(result.sessions) } }
    );
  }
  return redirect(result.target, {
    headers: { 'set-cookie': await serializeSessions(result.sessions) },
  });
}

export default function Signup() {
  const { csrfToken, organization, requestId, idp, prefill, maxmindAccountId } =
    useLoaderData<typeof loader>();
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

  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const serverError =
    actionData && 'error' in actionData && actionData.error === 'INVALID_INPUT'
      ? t`Please check your input and try again.`
      : undefined;

  if (actionData && 'sent' in actionData) {
    return (
      <AuthCard title={<Trans>Check your email</Trans>}>
        <TrackOnMount event="signup_submitted" />
        <p className="text-foreground text-center text-sm">
          <Trans>We've sent a verification link to {actionData.email}</Trans>
        </p>
      </AuthCard>
    );
  }

  return (
    <>
      <MaxMindTracker accountId={maxmindAccountId} />
      <AuthCard title={<Trans>Create your account</Trans>}>
        <Form.Root
          schema={registerClientSchema}
          formComponent={RRForm}
          method="POST"
          defaultValues={{
            email: prefill.email,
            firstName: prefill.firstName,
            lastName: prefill.lastName,
          }}
          isSubmitting={navigation.state === 'submitting'}
          className="flex flex-col gap-4">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="deviceTrackingToken" ref={deviceTokenRef} defaultValue="" />
          {organization ? <input type="hidden" name="organization" value={organization} /> : null}
          {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          {idp ? (
            <>
              <input type="hidden" name="idpIntentId" value={idp.idpIntentId} />
              <input type="hidden" name="idpIntentToken" value={idp.idpIntentToken} />
              <input type="hidden" name="idpId" value={idp.idpId} />
              <input type="hidden" name="idpUserId" value={idp.idpUserId} />
              <input type="hidden" name="idpUserName" value={idp.idpUserName} />
            </>
          ) : null}
          <Form.Field name="email" label={t`Email`} required>
            <Form.Input type="email" autoComplete="email" autoFocus />
          </Form.Field>
          <Form.Field name="firstName" label={t`First name`} required>
            <Form.Input type="text" autoComplete="given-name" />
          </Form.Field>
          <Form.Field name="lastName" label={t`Last name`} required>
            <Form.Input type="text" autoComplete="family-name" />
          </Form.Field>
          {serverError ? (
            <p role="alert" className="text-sm text-red-700">
              {serverError}
            </p>
          ) : null}
          <SubmitButton>
            <Trans>Continue</Trans>
          </SubmitButton>
        </Form.Root>
      </AuthCard>
    </>
  );
}
