import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { BackLink } from '@/components/back-link/back-link';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import {
  readSessions,
  byLoginName,
  addSession,
  serializeSessions,
} from '@/modules/auth/session/cookie';
import { submitOtpCode } from '@/resources/otp';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
import { type LoginLayoutData } from '@/routes/login/layout';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
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

export const meta: MetaFunction = () => [{ title: 'Enter your authenticator code' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? '';
  const organization = url.searchParams.get('organization') ?? undefined;

  // Guard: require an active session for this loginName.
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return redirect('/login');

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data({ csrfToken }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const formEntries = Object.fromEntries(form);
  const organization = (formEntries.organization as string) || undefined;
  const loginName = (formEntries.loginName as string) ?? '';

  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);

  const result = await submitOtpCode(provider, 'authenticator', formEntries, entry ?? undefined);
  if (!result.ok) {
    const status = result.error === 'INVALID_CREDENTIALS' ? 401 : 400;
    return data({ error: result.error }, { status });
  }

  // Write back the (potentially rotated) session token.
  const next = addSession(sessions, {
    ...entry!,
    token: result.session.token,
    changeTs: result.session.changedAt,
    expirationTs: result.session.expiresAt,
  });

  return redirect(result.target, {
    headers: { 'set-cookie': await serializeSessions(next) },
  });
}

export default function VerifyAuthenticator() {
  const { csrfToken } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useRouteLoaderData('login') as LoginLayoutData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

  return (
    <AuthCard title={<Trans>Enter your authenticator code</Trans>}>
      <div className="mb-4 flex flex-col items-center gap-2">
        <div className="self-start">
          <BackLink />
        </div>
        <IdentityBadge loginName={loginName} requestId={requestId} organization={organization} />
      </div>
      <div className="flex flex-col gap-4">
        <p className="text-foreground text-center text-sm">
          <Trans>Open your authenticator app and enter the 6-digit code.</Trans>
        </p>

        <Form.Root
          schema={otpCodeClientSchema}
          formComponent={RRForm}
          method="POST"
          defaultValues={{ code: '' }}
          isSubmitting={navigation.state === 'submitting'}
          className="flex flex-col gap-4">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="loginName" value={loginName} />
          {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          {organization ? <input type="hidden" name="organization" value={organization} /> : null}
          <Form.Field name="code" label={t`Authenticator code`} required>
            <Form.Input inputMode="numeric" autoComplete="one-time-code" autoFocus />
          </Form.Field>
          {errorMessage &&
          actionData &&
          'error' in actionData &&
          actionData.error !== 'SESSION_EXPIRED' ? (
            <p role="alert" className="text-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}
          {actionData && 'error' in actionData && actionData.error === 'SESSION_EXPIRED' ? (
            <p role="alert" className="text-sm text-red-700">
              <Trans>Your session has expired.</Trans>{' '}
              <Link to="/login" className="underline">
                <Trans>Sign in again</Trans>
              </Link>
            </p>
          ) : null}
          <SubmitButton>
            <Trans>Verify</Trans>
          </SubmitButton>
        </Form.Root>
      </div>
    </AuthCard>
  );
}
