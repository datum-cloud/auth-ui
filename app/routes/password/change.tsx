import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { PasswordRequirements } from '@/components/auth-form/password-requirements';
import { BackLink } from '@/components/back-link/back-link';
import { FormError } from '@/components/form-error/form-error';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { readSessions, mostRecent, byId } from '@/modules/auth/session/cookie';
import { changePassword } from '@/resources/password';
import { changePasswordClientSchemaFor } from '@/resources/password/password.schema';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { actionError } from '@/utils/errors/auth-error';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
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

export const meta: MetaFunction = () => [{ title: 'Change your password' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const { csrfToken, headers } = await loaderCsrf(request);
  // Resolve the active ceremony session so the form can carry its id and show whose
  // password is being changed. The session token never leaves the server cookie.
  const active = mostRecent(await readSessions(request));
  // Fetch the org's complexity policy (org-first from the active session, default-org fallback) so
  // the change-password form shows + validates against the same rules the provider enforces.
  const provider = providerForRequest(request);
  const passwordComplexity = await provider.getPasswordComplexity(
    await resolveOrg(provider, active?.organization)
  );
  return data(
    {
      csrfToken,
      sessionId: active?.id ?? '',
      loginName: active?.loginName ?? '',
      requestId: url.searchParams.get('requestId') ?? undefined,
      passwordComplexity,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  // Resolve the session token from the SIGNED cookie (never client input). The route
  // owns this request I/O and hands the service a lookup closure; the service parses,
  // dispatches changePasswordWithSession, and maps ProviderError → typed errors.
  const sessions = await readSessions(request);
  try {
    // Re-fetch the policy on POST (never trust the client) from the active session's org.
    const rawOrg = mostRecent(sessions)?.organization;
    const policy = await provider.getPasswordComplexity(await resolveOrg(provider, rawOrg));
    const result = await changePassword(
      provider,
      Object.fromEntries(form),
      (sessionId) => byId(sessions, sessionId),
      policy
    );
    if (result.ok) return redirect(result.target);
    return data({ error: result.error }, { status: 400 });
  } catch (err) {
    return actionError(err);
  }
}

export default function PasswordChange() {
  const { csrfToken, sessionId, loginName, requestId, passwordComplexity } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();
  const schema = useMemo(
    () => changePasswordClientSchemaFor(passwordComplexity),
    [passwordComplexity]
  );

  // Inline-only error surface: the action error renders in a <FormError> (role="alert")
  // inside the form — no toast.
  const errorMessage = useAuthActionError(actionData);

  return (
    <AuthCard title={<Trans>Change your password</Trans>}>
      <Form.Root
        schema={schema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ password: '', confirm: '' }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex w-full flex-col gap-4">
        <AuthFormFields csrf={csrfToken} requestId={requestId} />
        <input type="hidden" name="sessionId" value={sessionId} />
        {loginName ? (
          <IdentityBadge
            loginName={loginName}
            verb={<Trans>Signing in as</Trans>}
            showLink={false}
          />
        ) : null}
        <Form.Field name="password" label={t`New password`} required>
          <Form.Input type="password" autoFocus autoComplete="new-password" />
        </Form.Field>
        <PasswordRequirements policy={passwordComplexity} />
        <Form.Field name="confirm" label={t`Confirm password`} required>
          <Form.Input type="password" autoComplete="new-password" />
        </Form.Field>

        <FormError>{errorMessage}</FormError>
        <SubmitButton>
          <Trans>Change password</Trans>
        </SubmitButton>
      </Form.Root>

      {/* Back control → /login/password (previous-step.ts maps this path). */}
      <BackLink />
    </AuthCard>
  );
}
