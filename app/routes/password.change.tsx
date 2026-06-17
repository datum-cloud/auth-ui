import { changePasswordSchema } from './_schemas/verify';
import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import { ProviderError } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
import { readSessions, mostRecent, byId } from '@/session/cookie';
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
import { Form as RRForm, Link } from 'react-router';
import { z } from 'zod';

export const meta: MetaFunction = () => [{ title: 'Change your password' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
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

  const parsed = changePasswordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  const { sessionId, password, requestId } = parsed.data;

  // Resolve the session token from the signed cookie (never from client input).
  const session = byId(await readSessions(request), sessionId);
  if (!session) return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });

  try {
    await provider.changePasswordWithSession(session.id, session.token, password);
    logAuthEvent('password.change', 'success', { sessionId: session.id });
    return redirect(requestId ? `/authorize?requestId=${requestId}` : '/signed-in');
  } catch (error) {
    logAuthEvent('password.change', 'failure', { sessionId: session.id });
    if (error instanceof ProviderError) {
      // INITIAL-state users are normalized to PERMISSION_DENIED by the adapter; complexity
      // and credential failures get their own friendly copy. None of these are enumeration-
      // sensitive (the session already proves identity).
      if (
        error.code === 'PASSWORD_COMPLEXITY' ||
        error.code === 'INVALID_CREDENTIALS' ||
        error.code === 'PERMISSION_DENIED'
      ) {
        return data({ error: error.code }, { status: 400 });
      }
    }
    throw error;
  }
}

// Client-side validation: password + confirm match; sessionId comes via hidden input.
// Advisory only — the server's changePasswordSchema is the real gate.
const clientSchema = z
  .object({ password: z.string().min(8), confirm: z.string().min(8) })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

export default function PasswordChange() {
  const { csrfToken, sessionId, loginName, requestId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const error = actionData && 'error' in actionData ? actionData.error : undefined;

  return (
    <AuthCard title={<Trans>Change your password</Trans>}>
      <Form.Root
        schema={clientSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ password: '', confirm: '' }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex flex-col gap-4">
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

        {error === 'PASSWORD_COMPLEXITY' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>Your password does not meet the required complexity.</Trans>
          </p>
        )}
        {error === 'INVALID_CREDENTIALS' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>Could not change your password. Please try again.</Trans>
          </p>
        )}
        {error === 'PERMISSION_DENIED' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>This account must be activated from its invitation email first.</Trans>
          </p>
        )}
        {error === 'SESSION_EXPIRED' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>Your session has expired. Please</Trans>{' '}
            <Link to="/login" className="underline">
              <Trans>sign in again</Trans>
            </Link>
            .
          </p>
        )}
        {error === 'INVALID_INPUT' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>Passwords must match and be at least 8 characters.</Trans>
          </p>
        )}

        <SubmitButton>
          <Trans>Change password</Trans>
        </SubmitButton>
      </Form.Root>
    </AuthCard>
  );
}
