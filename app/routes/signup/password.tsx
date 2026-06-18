import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { BackLink } from '@/components/back-link/back-link';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import { TrackOnMount } from '@/modules/analytics/fathom';
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { MaxMindTracker, readMaxMindTrackingToken } from '@/modules/fraud/maxmind-tracker';
import { genericCheckYourEmail } from '@/resources/schemas/check-your-email.schema';
import { registerWithPassword } from '@/resources/signup';
import { signupPasswordSchema } from '@/resources/signup/signup.schema';
import { trustedAppOrigin } from '@/server/app-origin.server';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { requireEmailVerification } from '@/server/env';
import { env } from '@/utils/env/env.server';
import { actionError } from '@/utils/errors/auth-error';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
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
      deviceTrackingToken: url.searchParams.get('deviceTrackingToken') ?? '',
      maxmindAccountId: env.MAXMIND_ACCOUNT_ID ?? '',
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

  // SECURITY: the service builds the verify-mail URL template from a TRUSTED origin
  // (trustedAppOrigin → PUBLIC_ORIGIN), NOT the request Host header, to block
  // Host-header email-link injection. The enumeration-safe register dispatch and
  // post-register routing live in the service; the route only parses + renders.
  try {
    const result = await registerWithPassword(provider, await readSessions(request), {
      email: String(fields.loginName ?? ''),
      firstName: String(fields.firstName ?? ''),
      lastName: String(fields.lastName ?? ''),
      password: parsed.data.password,
      organization: fields.organization ? String(fields.organization) : undefined,
      requestId: fields.requestId ? String(fields.requestId) : undefined,
      deviceTrackingToken: fields.deviceTrackingToken
        ? String(fields.deviceTrackingToken)
        : undefined,
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
  } catch (err) {
    return actionError(err);
  }
}

export default function SignupPassword() {
  const {
    csrfToken,
    loginName,
    firstName,
    lastName,
    organization,
    requestId,
    deviceTrackingToken,
    maxmindAccountId,
  } = useLoaderData<typeof loader>();
  const deviceTokenRef = useRef<HTMLInputElement>(null);

  // The hidden input is seeded (defaultValue) with the token handed off in the URL so
  // it survives even with JS disabled. When MaxMindTracker mirrors a fresh token into
  // sessionStorage, prefer that — re-read on a short interval until it appears.
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

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

  if (actionData && 'sent' in actionData) {
    return (
      <AuthCard
        title={<Trans>Check your email</Trans>}
        description={
          <Trans>
            We've sent a verification link to <strong>{actionData.email}</strong>
          </Trans>
        }>
        <TrackOnMount event="signup_submitted" />
      </AuthCard>
    );
  }

  return (
    <>
      <MaxMindTracker accountId={maxmindAccountId} />
      <AuthCard
        title={<Trans>Set a password</Trans>}
        description={<Trans>You'll need to set a password to complete your signup.</Trans>}>
        <Form.Root
          schema={signupPasswordSchema}
          formComponent={RRForm}
          method="POST"
          defaultValues={{ password: '', confirm: '' }}
          isSubmitting={navigation.state === 'submitting'}
          className="flex w-full flex-col gap-4">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="loginName" value={loginName} />
          <input type="hidden" name="firstName" value={firstName} />
          <input type="hidden" name="lastName" value={lastName} />
          {organization ? <input type="hidden" name="organization" value={organization} /> : null}
          {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          <input
            type="hidden"
            name="deviceTrackingToken"
            ref={deviceTokenRef}
            defaultValue={deviceTrackingToken}
          />
          <Form.Field name="password" label={t`Password`} required>
            <Form.Input type="password" autoComplete="new-password" autoFocus />
          </Form.Field>
          <Form.Field name="confirm" label={t`Confirm password`} required>
            <Form.Input type="password" autoComplete="new-password" />
          </Form.Field>
          <SubmitButton>
            <Trans>Create account</Trans>
          </SubmitButton>
        </Form.Root>

        <div className="mt-4">
          <BackLink />
        </div>
      </AuthCard>
    </>
  );
}
