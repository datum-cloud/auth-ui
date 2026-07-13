import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { PasswordRequirements } from '@/components/auth-form/password-requirements';
import { BackLink } from '@/components/back-link/back-link';
import { FormError } from '@/components/form-error/form-error';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { submitNewPassword } from '@/resources/password';
import { newPasswordClientSchemaFor } from '@/resources/password/password.schema';
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

export const meta: MetaFunction = () => [{ title: 'Set new password' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const { csrfToken, headers } = await loaderCsrf(request);
  // The reset link carries the real `?organization`; resolveOrg keeps the default-org fallback for
  // safety. Fetch the policy so the form shows + validates against the org complexity rules.
  const rawOrg = url.searchParams.get('organization') ?? undefined;
  const provider = providerForRequest(request);
  const passwordComplexity = await provider.getPasswordComplexity(
    await resolveOrg(provider, rawOrg)
  );
  return data(
    {
      csrfToken,
      code: url.searchParams.get('code') ?? '',
      userId: url.searchParams.get('userId') ?? '',
      organization: rawOrg,
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

  // The service parses (incl. the requestId allowlist), calls the provider,
  // and maps ProviderError → typed errors. The route only wires the result to a
  // redirect (success) or a 400 data() error (the render reads `error`).
  try {
    const fields = Object.fromEntries(form);
    // Re-fetch the policy on POST (never trust the client) so server validation matches the policy.
    const rawOrg = fields.organization ? String(fields.organization) : undefined;
    const policy = await provider.getPasswordComplexity(await resolveOrg(provider, rawOrg));
    const result = await submitNewPassword(provider, fields, policy);
    if (result.ok) return redirect(result.target);
    return data({ error: result.error }, { status: 400 });
  } catch (err) {
    return actionError(err);
  }
}

export default function PasswordNew() {
  const { csrfToken, code, userId, organization, requestId, passwordComplexity } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();
  const schema = useMemo(
    () => newPasswordClientSchemaFor(passwordComplexity),
    [passwordComplexity]
  );

  // Inline-only error surface: the action error renders in a <FormError> (role="alert")
  // inside the form — no toast.
  const errorMessage = useAuthActionError(actionData);

  return (
    <AuthCard title={<Trans>Choose a new password</Trans>}>
      <Form.Root
        schema={schema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ password: '', confirm: '' }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex w-full flex-col gap-4">
        <AuthFormFields csrf={csrfToken} requestId={requestId} organization={organization} />
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="userId" value={userId} />
        <Form.Field name="password" label={t`New password`} required>
          <Form.Input type="password" autoFocus autoComplete="new-password" />
        </Form.Field>
        <PasswordRequirements policy={passwordComplexity} />
        <Form.Field name="confirm" label={t`Confirm new password`} required>
          <Form.Input type="password" autoComplete="new-password" />
        </Form.Field>
        <FormError>{errorMessage}</FormError>
        <SubmitButton>
          <Trans>Set password</Trans>
        </SubmitButton>
      </Form.Root>

      {/* Back control → /login/password (previous-step.ts maps this path). */}
      <BackLink />
    </AuthCard>
  );
}
