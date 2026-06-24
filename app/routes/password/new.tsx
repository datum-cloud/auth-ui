import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { BackLink } from '@/components/back-link/back-link';
import { FormError } from '@/components/form-error/form-error';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { submitNewPassword } from '@/resources/password';
import { newPasswordClientSchema } from '@/resources/password/password.schema';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { actionError } from '@/utils/errors/auth-error';
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

export const meta: MetaFunction = () => [{ title: 'Set new password' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const { csrfToken, headers } = await loaderCsrf(request);
  return data(
    {
      csrfToken,
      code: url.searchParams.get('code') ?? '',
      userId: url.searchParams.get('userId') ?? '',
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

  // The service parses (incl. the requestId allowlist), calls the provider,
  // and maps ProviderError → typed errors. The route only wires the result to a
  // redirect (success) or a 400 data() error (the render reads `error`).
  try {
    const result = await submitNewPassword(provider, Object.fromEntries(form));
    if (result.ok) return redirect(result.target);
    return data({ error: result.error }, { status: 400 });
  } catch (err) {
    return actionError(err);
  }
}

export default function PasswordNew() {
  const { csrfToken, code, userId, organization, requestId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  // Inline-only error surface: the action error renders in a <FormError> (role="alert")
  // inside the form — no toast.
  const errorMessage = useAuthActionError(actionData);

  return (
    <AuthCard title={<Trans>Choose a new password</Trans>}>
      <Form.Root
        schema={newPasswordClientSchema}
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
