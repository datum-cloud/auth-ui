import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { BackLink } from '@/components/back-link/back-link';
import { FormError } from '@/components/form-error/form-error';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { readSessions, mostRecent, byId } from '@/modules/auth/session/cookie';
import { changePassword } from '@/resources/password';
import { changePasswordClientSchema } from '@/resources/password/password.schema';
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

export const meta: MetaFunction = () => [{ title: 'Change your password' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const { csrfToken, headers } = await loaderCsrf(request);
  // Resolve the active ceremony session so the form can carry its id and show whose
  // password is being changed. The session token never leaves the server cookie.
  const active = mostRecent(await readSessions(request));
  return data(
    {
      csrfToken,
      sessionId: active?.id ?? '',
      loginName: active?.loginName ?? '',
      requestId: url.searchParams.get('requestId') ?? undefined,
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
    const result = await changePassword(provider, Object.fromEntries(form), (sessionId) =>
      byId(sessions, sessionId)
    );
    if (result.ok) return redirect(result.target);
    return data({ error: result.error }, { status: 400 });
  } catch (err) {
    return actionError(err);
  }
}

export default function PasswordChange() {
  const { csrfToken, sessionId, loginName, requestId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  // Inline-only error surface: the action error renders in a <FormError> (role="alert")
  // inside the form — no toast.
  const errorMessage = useAuthActionError(actionData);

  return (
    <AuthCard title={<Trans>Change your password</Trans>}>
      <Form.Root
        schema={changePasswordClientSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ password: '', confirm: '' }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex w-full flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="sessionId" value={sessionId} />
        {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
        {loginName ? <p className="text-foreground text-center text-sm">{loginName}</p> : null}
        <Form.Field name="password" label={t`New password`} required>
          <Form.Input type="password" autoFocus autoComplete="new-password" />
        </Form.Field>
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
