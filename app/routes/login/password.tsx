import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
// ADAPTATION (plan-drift fix): readSessions/serializeSessions live in @/modules/auth/session/cookie
// (which re-exports them from session.ts) — the canonical one-stop import for route-layer session I/O.
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { verifyLoginPassword } from '@/resources/login';
import { loginPasswordSchema, loginPasswordClientSchema } from '@/resources/login/login.schema';
import { type LoginLayoutData } from '@/routes/login/layout';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm, Link } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Enter your password' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const [csrfToken, setCookie] = await getCsrfToken(request);
  // DEVIATION 3 (getCsrfToken null-guard): only set 'set-cookie' when non-null (same as login.tsx).
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  return data(
    {
      csrfToken,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);
  const parsed = loginPasswordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  const { password, loginName, requestId, organization } = parsed.data;

  const list = await readSessions(request);
  const result = await verifyLoginPassword(provider, list, {
    password,
    loginName,
    requestId,
    organization,
  });

  if (!result.ok) {
    if (result.error === 'SESSION_EXPIRED') {
      return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });
    }
    return data(
      {
        error: 'INVALID_CREDENTIALS' as const,
        failedAttempts: result.failedAttempts,
        maxAttempts: result.maxAttempts,
      },
      { status: 401 }
    );
  }

  return redirect(result.target, {
    headers: { 'set-cookie': await serializeSessions(result.sessions) },
  });
}

export default function Password() {
  const { csrfToken } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useRouteLoaderData('login') as LoginLayoutData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const serverError =
    actionData && 'error' in actionData
      ? actionData.error === 'INVALID_CREDENTIALS'
        ? {
            kind: 'INVALID_CREDENTIALS' as const,
            message: t`Could not verify password`,
            failedAttempts: 'failedAttempts' in actionData ? actionData.failedAttempts : undefined,
            maxAttempts: 'maxAttempts' in actionData ? actionData.maxAttempts : undefined,
          }
        : actionData.error === 'SESSION_EXPIRED'
          ? { kind: 'SESSION_EXPIRED' as const }
          : { kind: 'INVALID_INPUT' as const }
      : undefined;

  return (
    <AuthCard title={<Trans>Enter your password</Trans>}>
      <Form.Root
        schema={loginPasswordClientSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ password: '' }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="loginName" value={loginName} />
        {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
        {organization ? <input type="hidden" name="organization" value={organization} /> : null}
        <Form.Field name="password" label={t`Enter your password`} required>
          <Form.Input type="password" autoComplete="current-password" autoFocus />
        </Form.Field>
        {serverError?.kind === 'INVALID_CREDENTIALS' && (
          <p role="alert" className="text-sm text-red-700">
            {serverError.message}
            {serverError.failedAttempts != null && serverError.maxAttempts != null
              ? ` (${serverError.failedAttempts}/${serverError.maxAttempts})`
              : null}
          </p>
        )}
        {serverError?.kind === 'SESSION_EXPIRED' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>Your session has expired.</Trans>{' '}
            <Link to="/login" className="underline">
              <Trans>Sign in again</Trans>
            </Link>
          </p>
        )}
        {serverError?.kind === 'INVALID_INPUT' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>Please check your input and try again.</Trans>
          </p>
        )}
        <SubmitButton>
          <Trans>Sign in</Trans>
        </SubmitButton>
      </Form.Root>
    </AuthCard>
  );
}
