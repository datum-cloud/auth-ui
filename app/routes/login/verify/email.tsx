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
import { dispatchEmailChallenge, submitOtpCode } from '@/resources/otp';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
import { type LoginLayoutData } from '@/routes/login/layout';
import { trustedAppOrigin } from '@/server/app-origin.server';
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

export const meta: MetaFunction = () => [{ title: 'Enter your email code' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;
  // Pre-fill the code when the user arrives via the emailed OTP link
  // (/id/login/verify/email?code=…&loginName=…). Typed-in codes (no query param) keep ''.
  const code = url.searchParams.get('code') ?? '';

  // Guard: require an active session for this loginName.
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return redirect('/login');

  // Trigger the email code send via the challenges seam (P5), but ONLY on first arrival.
  // When the user follows the emailed link (code present) the code is already in hand — a
  // re-send would rotate/invalidate it. So suppress the duplicate challenge in the link path.
  if (!code) {
    await dispatchEmailChallenge(providerForRequest(request), entry, {
      origin: trustedAppOrigin(request),
      loginName,
      requestId,
      organization,
    });
  }

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  const next = url.searchParams.get('next') ?? undefined;

  return data({ csrfToken, code, next }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const formEntries = Object.fromEntries(form);
  const organization = (formEntries.organization as string) || undefined;
  const loginName = (formEntries.loginName as string) ?? '';
  const requestId = (formEntries.requestId as string) || undefined;
  const nextParam = String(formEntries.next ?? '');

  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);

  const result = await submitOtpCode(provider, 'email', formEntries, entry ?? undefined);
  if (!result.ok) {
    const status = result.error === 'INVALID_CREDENTIALS' ? 401 : 400;
    return data({ error: result.error }, { status });
  }

  // Write back the (potentially rotated) session token.
  const updatedSessions = addSession(sessions, {
    ...entry!,
    token: result.session.token,
    changeTs: result.session.changedAt,
    expirationTs: result.session.expiresAt,
  });

  if (nextParam === 'passkey') {
    const p = new URLSearchParams({ loginName, force: 'false', checkAfter: 'false' });
    if (organization) p.set('organization', organization);
    if (requestId) p.set('requestId', requestId);
    return redirect(`/setup/passkey?${p.toString()}`, {
      headers: { 'set-cookie': await serializeSessions(updatedSessions) },
    });
  }

  return redirect(result.target, {
    headers: { 'set-cookie': await serializeSessions(updatedSessions) },
  });
}

export default function VerifyEmail() {
  const { csrfToken, code, next } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useRouteLoaderData('login') as LoginLayoutData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

  return (
    <AuthCard
      title={<Trans>Enter your email code</Trans>}
      description={<Trans>Enter the one-time code sent to your email address.</Trans>}>
      <div className="flex flex-col items-baseline justify-center gap-4">
        <IdentityBadge loginName={loginName} requestId={requestId} organization={organization} />

        <Form.Root
          schema={otpCodeClientSchema}
          formComponent={RRForm}
          method="POST"
          defaultValues={{ code }}
          isSubmitting={navigation.state === 'submitting'}
          className="flex flex-col gap-4">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="loginName" value={loginName} />
          {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          {organization ? <input type="hidden" name="organization" value={organization} /> : null}
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <Form.Field name="code" label={t`Email code`} required>
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

        <BackLink />
      </div>
    </AuthCard>
  );
}
