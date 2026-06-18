import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { BackLink } from '@/components/back-link/back-link';
import { FormError } from '@/components/form-error/form-error';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
// ADAPTATION (plan-drift fix): readSessions/serializeSessions live in @/modules/auth/session/cookie
// (which re-exports them from session.ts) — the canonical one-stop import for route-layer session I/O.
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { verifyLoginPassword } from '@/resources/login';
import { attemptsRemaining } from '@/resources/login/login-view';
import { loginPasswordSchema, loginPasswordClientSchema } from '@/resources/login/login.schema';
import { type LoginLayoutData } from '@/routes/login/layout';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
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
  const url = new URL(request.url);
  const organization = url.searchParams.get('organization') ?? undefined;
  const provider = providerForRequest(request);
  const settings = await provider.getLoginSettings(organization);
  const [csrfToken, setCookie] = await getCsrfToken(request);
  // DEVIATION 3 (getCsrfToken null-guard): only set 'set-cookie' when non-null (same as login.tsx).
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  return data({ csrfToken, hidePasswordReset: settings.hidePasswordReset === true }, { headers });
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
  const { csrfToken, hidePasswordReset } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useRouteLoaderData('login') as LoginLayoutData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

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

  const attempts =
    serverError?.kind === 'INVALID_CREDENTIALS'
      ? attemptsRemaining(serverError.failedAttempts, serverError.maxAttempts)
      : null;

  const extra = new URLSearchParams();
  if (requestId) extra.set('requestId', requestId);
  if (organization) extra.set('organization', organization);
  const resetHref = extra.toString() ? `/password/reset?${extra.toString()}` : '/password/reset';

  return (
    <AuthCard title={<Trans>Enter your password</Trans>}>
      <div className="mb-4 flex flex-col items-center gap-2">
        <div className="self-start">
          <BackLink />
        </div>
        <IdentityBadge loginName={loginName} requestId={requestId} organization={organization} />
      </div>
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
          <FormError>
            {serverError.message}
            {attempts?.kind === 'locked' ? (
              <>
                {' '}
                <Trans>Your account is temporarily locked after too many attempts.</Trans>
              </>
            ) : attempts?.kind === 'remaining' ? (
              <>
                {' '}
                <Plural
                  value={attempts.count}
                  one="# attempt remaining."
                  other="# attempts remaining."
                />
              </>
            ) : null}
          </FormError>
        )}
        {serverError?.kind === 'SESSION_EXPIRED' && (
          <FormError>
            <Trans>Your session has expired.</Trans>{' '}
            <Link to="/login" className="underline">
              <Trans>Sign in again</Trans>
            </Link>
          </FormError>
        )}
        {serverError?.kind === 'INVALID_INPUT' && (
          <FormError>
            <Trans>Please check your input and try again.</Trans>
          </FormError>
        )}

        <SubmitButton>
          <Trans>Sign in</Trans>
        </SubmitButton>
      </Form.Root>

      {!hidePasswordReset ? (
        <p className="mt-4 text-center text-sm">
          <Link to={resetHref} className="text-gray-600 underline">
            <Trans>Forgot password?</Trans>
          </Link>
        </p>
      ) : null}
    </AuthCard>
  );
}
