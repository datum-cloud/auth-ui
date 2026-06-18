import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import { submitNewPassword } from '@/resources/password';
import { newPasswordClientSchema } from '@/resources/password/password.schema';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { actionError } from '@/utils/errors/auth-error';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
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
  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
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

  // The service parses (incl. the CODE-MIN-24 requestId allowlist), calls the provider,
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

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

  return (
    <AuthCard title={<Trans>Choose a new password</Trans>}>
      <Form.Root
        schema={newPasswordClientSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ password: '', confirm: '' }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex w-full flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="userId" value={userId} />
        {organization ? <input type="hidden" name="organization" value={organization} /> : null}
        {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
        <Form.Field name="password" label={t`New password`} required>
          <Form.Input type="password" autoFocus autoComplete="new-password" />
        </Form.Field>
        <Form.Field name="confirm" label={t`Confirm new password`} required>
          <Form.Input type="password" autoComplete="new-password" />
        </Form.Field>
        <SubmitButton>
          <Trans>Set password</Trans>
        </SubmitButton>
      </Form.Root>
    </AuthCard>
  );
}
