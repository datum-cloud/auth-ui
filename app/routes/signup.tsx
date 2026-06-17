import { genericCheckYourEmail } from './_schemas/check-your-email';
import { registerSchema } from './_schemas/register';
import { trustedAppOrigin } from './_shared/app-origin.server';
import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import { postRegisterStep } from '@/flows/post-register';
import { verifyUrlTemplate } from '@/flows/verify-url-template';
import { ProviderError } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { requireEmailVerification } from '@/server/env';
import { logAuthEvent, hashActor } from '@/server/observability';
import { readSessions, addSession, serializeSessions } from '@/session/cookie';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
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

  // Phase 4 register-and-link: if an IdP intent rode in (from /sso/:provider/callback), compose
  // register → addIdpLink → createSession in one logical step (route/flow level, not an
  // AuthProvider method). IdP users are passwordless — they skip the /signup/password path below.
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
    const idpLink = {
      idpId,
      idpUserId: String(form.get('idpUserId') ?? ''),
      idpUserName: String(form.get('idpUserName') ?? ''),
    };
    const user = await provider.register({
      email,
      firstName,
      lastName,
      orgId: organization,
    });
    // CODE-MIN-04: link explicitly via addIdpLink — RegisterInput.idpLink is a dead field no
    // provider reads, so passing it to register() was a confusing no-op. addIdpLink is the
    // single, real link path.
    await provider.addIdpLink(user.id, idpLink);
    const session = await provider.createSession(
      { idpIntent: { idpIntentId, idpIntentToken } },
      { orgId: organization, requestId, metadata: { userId: user.id } }
    );
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
    logAuthEvent('signup.requested', 'success', { actor: hashActor(user.loginName), organization });
    const target = requestId
      ? `/authorize?requestId=${encodeURIComponent(requestId)}`
      : '/signed-in';
    return redirect(target, { headers: { 'set-cookie': await serializeSessions(next) } });
  }

  const settings = await provider.getLoginSettings(organization);

  if (settings.allowPassword) {
    // Password-first path: carry all fields to /signup/password.
    // loginName in the URL param lets signupRateLimit key on it for /signup/password.
    logAuthEvent('signup.requested', 'success', { actor: hashActor(email), organization });
    const params = new URLSearchParams({ loginName: email, firstName, lastName });
    if (organization) params.set('organization', organization);
    if (requestId) params.set('requestId', requestId);
    if (deviceTrackingToken) params.set('deviceTrackingToken', deviceTrackingToken);
    return redirect(`/signup/password?${params}`);
  }

  // Passkey-first path: register directly, then apply enumeration-safe handling.
  if (requireEmailVerification()) {
    try {
      const user = await provider.register({
        email,
        firstName,
        lastName,
        orgId: organization,
        // Steer the verification mail's link back to OUR /verify route (see
        // flows/verify-url-template.ts) so the click-the-link continuation stays
        // inside auth-ui instead of the provider's built-in page. The origin is
        // sourced from trusted config (PUBLIC_ORIGIN), NOT the request Host header,
        // to prevent Host-header email-link injection — see trustedAppOrigin.
        verifyUrlTemplate: verifyUrlTemplate({ origin: trustedAppOrigin(request), requestId }),
      });

      // Persist a ceremony session so the email-link return flow (/verify) can resume.
      const session = await provider.createSession(
        {},
        { orgId: organization, requestId, metadata: { userId: user.id } }
      );
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
      logAuthEvent('signup.requested', 'success', { actor: hashActor(email), organization });
      return data(
        { sent: true as const, email },
        { status: 200, headers: { 'set-cookie': await serializeSessions(next) } }
      );
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'ALREADY_EXISTS') {
        // ENUMERATION SAFETY: equivalent-cost no-op path (timing hardening is a Phase 6 item).
        // We intentionally do NOT branch audit outcome on existence — same event as success.
        logAuthEvent('signup.requested', 'success', { actor: hashActor(email) });
        return genericCheckYourEmail(email);
      }
      throw error;
    }
  }

  // Verification not required: register and route forward.
  try {
    const user = await provider.register({ email, firstName, lastName, orgId: organization });
    const session = await provider.createSession(
      {},
      { orgId: organization, requestId, metadata: { userId: user.id } }
    );
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
    logAuthEvent('signup.requested', 'success', { actor: hashActor(email), organization });
    const target = postRegisterStep({
      hasPassword: false,
      emailVerified: false,
      requireVerification: false,
      loginName: user.loginName,
      userId: user.id,
      organization,
      requestId,
    });
    return redirect(target, { headers: { 'set-cookie': await serializeSessions(next) } });
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'ALREADY_EXISTS') {
      // Minor asymmetry: no email step when verification is off, but still generic response.
      logAuthEvent('signup.requested', 'success', { actor: hashActor(email) });
      return genericCheckYourEmail(email);
    }
    throw error;
  }
}

// client-side validation subset; advisory only (server action's schema is the real gate)
const clientSchema = registerSchema.pick({ email: true, firstName: true, lastName: true });

export default function Signup() {
  const { csrfToken, organization, requestId, idp, prefill } = useLoaderData<typeof loader>();
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
        <p className="text-foreground text-center text-sm">
          <Trans>We've sent a verification link to {actionData.email}</Trans>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={<Trans>Create your account</Trans>}>
      <Form.Root
        schema={clientSchema}
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
  );
}
