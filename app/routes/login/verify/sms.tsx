import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import {
  readSessions,
  byLoginName,
  addSession,
  serializeSessions,
} from '@/modules/auth/session/cookie';
import { dispatchSmsChallenge, submitOtpCode } from '@/resources/otp';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
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

export const meta: MetaFunction = () => [{ title: 'Enter your SMS code' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? '';
  const organization = url.searchParams.get('organization') ?? undefined;

  // Guard: require an active session for this loginName.
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return redirect('/login');

  // Trigger the SMS code send via the challenges seam (P5).
  await dispatchSmsChallenge(providerForRequest(request), entry, loginName);

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

  const result = await submitOtpCode(provider, 'sms', formEntries, entry ?? undefined);
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

export default function VerifySms() {
  const { csrfToken } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useRouteLoaderData('login') as LoginLayoutData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const serverError =
    actionData && 'error' in actionData
      ? actionData.error === 'INVALID_CREDENTIALS'
        ? t`The code is invalid or has expired. Please try again.`
        : actionData.error === 'SESSION_EXPIRED'
          ? null // handled inline with a link
          : t`Please check your input and try again.`
      : undefined;

  return (
    <AuthCard title={<Trans>Enter your SMS code</Trans>}>
      <div className="flex flex-col gap-4">
        <p className="text-foreground text-center text-sm">
          <Trans>Enter the one-time code sent to your phone.</Trans>
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
          <Form.Field name="code" label={t`SMS code`} required>
            <Form.Input inputMode="numeric" autoComplete="one-time-code" autoFocus />
          </Form.Field>
          {serverError ? (
            <p role="alert" className="text-sm text-red-700">
              {serverError}
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
