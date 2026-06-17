import { genericCheckYourEmail } from './_schemas/check-your-email';
import { signupPasswordSchema } from './_schemas/register';
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

export const meta: MetaFunction = () => [{ title: 'Set a password' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  return data(
    {
      csrfToken,
      loginName: url.searchParams.get('loginName') ?? '',
      firstName: url.searchParams.get('firstName') ?? '',
      lastName: url.searchParams.get('lastName') ?? '',
      organization: url.searchParams.get('organization') ?? undefined,
      requestId: url.searchParams.get('requestId') ?? undefined,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const fields = Object.fromEntries(form);
  const parsed = signupPasswordSchema.safeParse(fields);
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const email = String(fields.loginName ?? '');
  const firstName = String(fields.firstName ?? '');
  const lastName = String(fields.lastName ?? '');
  const organization = fields.organization ? String(fields.organization) : undefined;
  const requestId = fields.requestId ? String(fields.requestId) : undefined;

  // Steer the verification mail's link back to OUR /verify route (raw provider
  // placeholders, filled by Zitadel). Without this, register() sends the mail with
  // the provider's built-in url, and the "click the link" continuation escapes
  // auth-ui — see flows/verify-url-template.ts. requestId rides along so the
  // post-verify step can resume an OIDC/SAML ceremony. The origin comes from trusted
  // config (PUBLIC_ORIGIN), NOT the request Host header, to block Host-header
  // email-link injection — see trustedAppOrigin.
  const tmpl = verifyUrlTemplate({ origin: trustedAppOrigin(request), requestId });

  // Shared enumeration-safe registration: the success path and the ALREADY_EXISTS
  // path return the IDENTICAL response when verification is required, so a duplicate
  // email is indistinguishable from a fresh signup (the genericCheckYourEmail helper
  // is the single source of that response — see _schemas/check-your-email.ts).
  const register = () =>
    provider.register({
      email,
      firstName,
      lastName,
      password: parsed.data.password,
      orgId: organization,
      verifyUrlTemplate: tmpl,
    });

  if (requireEmailVerification()) {
    try {
      const user = await register();
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
        // ENUMERATION SAFETY: same audit event + identical response as the success path
        // (never surface error.message — raw "User already exists" leaks account existence).
        logAuthEvent('signup.requested', 'success', { actor: hashActor(email) });
        return genericCheckYourEmail(email);
      }
      throw error;
    }
  }

  // Verification not required: register and route forward; duplicate still generic.
  try {
    const user = await register();
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
    logAuthEvent('signup.created', 'success', {
      userId: user.id,
      actor: hashActor(user.loginName),
    });
    const target = postRegisterStep({
      hasPassword: true,
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
      logAuthEvent('signup.requested', 'success', { actor: hashActor(email) });
      return genericCheckYourEmail(email);
    }
    throw error;
  }
}

export default function SignupPassword() {
  const { csrfToken, loginName, firstName, lastName, organization, requestId } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const serverError =
    actionData && 'error' in actionData && actionData.error === 'INVALID_INPUT'
      ? t`Passwords must match and be at least 8 characters.`
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
    <AuthCard title={<Trans>Set a password</Trans>}>
      <Form.Root
        schema={signupPasswordSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ password: '', confirm: '' }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="loginName" value={loginName} />
        <input type="hidden" name="firstName" value={firstName} />
        <input type="hidden" name="lastName" value={lastName} />
        {organization ? <input type="hidden" name="organization" value={organization} /> : null}
        {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
        <Form.Field name="password" label={t`Password`} required>
          <Form.Input type="password" autoComplete="new-password" autoFocus />
        </Form.Field>
        <Form.Field name="confirm" label={t`Confirm password`} required>
          <Form.Input type="password" autoComplete="new-password" />
        </Form.Field>
        {serverError ? (
          <p role="alert" className="text-sm text-red-700">
            {serverError}
          </p>
        ) : null}
        <SubmitButton>
          <Trans>Create account</Trans>
        </SubmitButton>
      </Form.Root>
    </AuthCard>
  );
}
