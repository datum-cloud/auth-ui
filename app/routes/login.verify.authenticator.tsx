import { nextStepWithParams } from './_shared/next-step-params';
import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import { otpCodeSchema } from '@/flows/mfa-schemas';
import { ProviderError } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
import { readSessions, byLoginName, addSession, serializeSessions } from '@/session/cookie';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm, Link } from 'react-router';
import { z } from 'zod';

export const meta: MetaFunction = () => [{ title: 'Enter your authenticator code' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;

  // Guard: require an active session for this loginName.
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return redirect('/login');

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data({ csrfToken, loginName, requestId, organization }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = z
    .object({
      code: otpCodeSchema.shape.code,
      loginName: z.string().min(1),
      requestId: z.string().optional(),
      organization: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const { code, loginName, requestId, organization } = parsed.data;

  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });

  let session;
  try {
    session = await provider.updateSession(entry.id, entry.token, { totp: code });
  } catch (err) {
    logAuthEvent('mfa_totp', 'failure', { loginName });
    if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
      return data({ error: 'INVALID_CREDENTIALS' as const }, { status: 401 });
    }
    throw err;
  }

  logAuthEvent('mfa_totp', 'success', {
    userId: session.user?.id,
    sessionId: session.id,
  });

  // Write back the (potentially rotated) session token.
  const next = addSession(sessions, {
    ...entry,
    token: session.token,
    changeTs: session.changedAt,
    expirationTs: session.expiresAt,
  });

  const userId = session.user?.id ?? '';
  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(userId),
    provider.getLoginSettings(organization),
  ]);

  const target = nextStepWithParams({
    factors: session.factors,
    settings,
    enrolledMethods: methods,
    loginName: session.user?.loginName ?? loginName,
    userVerified: session.factors.passkey?.userVerified ?? false,
    mfaInitSkippedAt: session.user?.mfaInitSkippedAt,
    requestId,
    organization,
  });

  return redirect(target, {
    headers: { 'set-cookie': await serializeSessions(next) },
  });
}

const clientSchema = z.object({ code: z.string().min(1) });

export default function VerifyAuthenticator() {
  const { csrfToken, loginName, requestId, organization } = useLoaderData<typeof loader>();
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
    <AuthCard title={<Trans>Enter your authenticator code</Trans>}>
      <div className="flex flex-col gap-4">
        <p className="text-foreground text-center text-sm">
          <Trans>Open your authenticator app and enter the 6-digit code.</Trans>
        </p>

        <Form.Root
          schema={clientSchema}
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
