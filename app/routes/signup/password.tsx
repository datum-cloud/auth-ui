import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { PasswordRequirements } from '@/components/auth-form/password-requirements';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { TrackOnMount } from '@/modules/analytics/fathom';
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { MaxMindTracker, readMaxMindTrackingToken } from '@/modules/fraud/maxmind-tracker';
import { genericCheckYourEmail } from '@/resources/schemas/check-your-email.schema';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { registerWithPassword } from '@/resources/signup';
import { signupPasswordSchemaFor } from '@/resources/signup/signup.schema';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { requireEmailVerification } from '@/server/env';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { userAgentFromRequest } from '@/server/user-agent';
import { actionError } from '@/utils/errors/auth-error';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useRef } from 'react';
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
  const { csrfToken, headers } = await loaderCsrf(request);
  const rawOrg = url.searchParams.get('organization') ?? undefined;
  // Fetch the org's password-complexity policy so the form renders the requirement checklist and
  // validates against it (org-first, default-org fallback via resolveOrg).
  const provider = providerForRequest(request);
  const passwordComplexity = await provider.getPasswordComplexity(
    await resolveOrg(provider, rawOrg)
  );
  return data(
    {
      csrfToken,
      loginName: url.searchParams.get('loginName') ?? '',
      firstName: url.searchParams.get('firstName') ?? '',
      lastName: url.searchParams.get('lastName') ?? '',
      organization: rawOrg,
      requestId: url.searchParams.get('requestId') ?? undefined,
      deviceTrackingToken: url.searchParams.get('deviceTrackingToken') ?? '',
      maxmindAccountId: env.MAXMIND_ACCOUNT_ID ?? '',
      passwordComplexity,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const fields = Object.fromEntries(form);
  // Re-fetch the policy on POST (never trust the client) so the server validation reflects the
  // same org complexity rules the form advertised.
  const rawOrg = fields.organization ? String(fields.organization) : undefined;
  const policy = await provider.getPasswordComplexity(await resolveOrg(provider, rawOrg));
  const parsed = signupPasswordSchemaFor(policy).safeParse(fields);
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  // SECURITY: the service builds the verify-mail URL template from a TRUSTED origin
  // (trustedAppOrigin → PUBLIC_ORIGIN), NOT the request Host header, to block
  // Host-header email-link injection. The enumeration-safe register dispatch and
  // post-register routing live in the service; the route only parses + renders.
  try {
    const deviceTrackingToken = fields.deviceTrackingToken
      ? String(fields.deviceTrackingToken)
      : undefined;
    const result = await registerWithPassword(provider, await readSessions(request), {
      email: String(fields.loginName ?? ''),
      firstName: String(fields.firstName ?? ''),
      lastName: String(fields.lastName ?? ''),
      password: parsed.data.password,
      organization: fields.organization ? String(fields.organization) : undefined,
      requestId: fields.requestId ? String(fields.requestId) : undefined,
      deviceTrackingToken,
      userAgent: userAgentFromRequest(request, deviceTrackingToken),
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
    passwordComplexity,
  } = useLoaderData<typeof loader>();
  const deviceTokenRef = useRef<HTMLInputElement>(null);
  // Client schema mirrors the fetched policy so inline validation matches the checklist + server.
  const schema = useMemo(() => signupPasswordSchemaFor(passwordComplexity), [passwordComplexity]);

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

  // The action error surfaces INLINE through <AuthCeremony error> (this
  // replaces the per-route toast).
  const errorMessage = useAuthActionError(actionData);

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
      <AuthCeremony
        title={<Trans>Set a password</Trans>}
        description={<Trans>You'll need to set a password to complete your signup.</Trans>}
        error={errorMessage}>
        <Form.Root
          schema={schema}
          formComponent={RRForm}
          method="POST"
          defaultValues={{ password: '', confirm: '' }}
          isSubmitting={navigation.state === 'submitting'}
          className="flex w-full flex-col gap-4">
          <AuthFormFields
            csrf={csrfToken}
            loginName={loginName}
            requestId={requestId}
            organization={organization}
          />
          <input type="hidden" name="firstName" value={firstName} />
          <input type="hidden" name="lastName" value={lastName} />
          <input
            type="hidden"
            name="deviceTrackingToken"
            ref={deviceTokenRef}
            defaultValue={deviceTrackingToken}
          />
          <Form.Field name="password" label={t`Password`} required>
            <Form.Input type="password" autoComplete="new-password" autoFocus />
          </Form.Field>
          <PasswordRequirements policy={passwordComplexity} />
          <Form.Field name="confirm" label={t`Confirm password`} required>
            <Form.Input type="password" autoComplete="new-password" />
          </Form.Field>
          <SubmitButton>
            <Trans>Create account</Trans>
          </SubmitButton>
        </Form.Root>
      </AuthCeremony>
    </>
  );
}
