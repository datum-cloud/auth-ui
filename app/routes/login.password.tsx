import { nextStepWithParams } from './_shared/next-step-params';
import { REQUEST_ID_PATTERN } from './_shared/request-id';
import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import { ProviderError } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent, hashActor } from '@/server/observability';
// ADAPTATION (plan-drift fix): same pattern as login.tsx — readSessions/addSession/serializeSessions
// and byLoginName all live in @/session/cookie (which re-exports them from session.ts).
// The locked plan block listed byLoginName as coming from @/session/session — that still works
// but @/session/cookie is the canonical one-stop import for route-layer session I/O.
import { readSessions, addSession, serializeSessions, byLoginName } from '@/session/cookie';
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

export const meta: MetaFunction = () => [{ title: 'Enter your password' }];

const schema = z.object({
  password: z.string().min(1).max(512),
  loginName: z.string().min(1),
  requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  organization: z.string().optional(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const [csrfToken, setCookie] = await getCsrfToken(request);
  // DEVIATION 3 (getCsrfToken null-guard): only set 'set-cookie' when non-null (same as login.tsx).
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  return data(
    {
      csrfToken,
      loginName: url.searchParams.get('loginName') ?? '',
      requestId: url.searchParams.get('requestId') ?? undefined,
      organization: url.searchParams.get('organization') ?? undefined,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  const { password, loginName, requestId, organization } = parsed.data;

  const list = await readSessions(request);
  const entry = byLoginName(list, loginName, organization);
  if (!entry) return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });

  let session;
  try {
    session = await provider.updateSession(entry.id, entry.token, { password });
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'INVALID_CREDENTIALS') {
      // DEVIATION 2 (logAuthEvent §C(f)): emit failure event — never log the password.
      logAuthEvent('password_check', 'failure', { actor: hashActor(loginName) });
      return data(
        {
          error: 'INVALID_CREDENTIALS' as const,
          failedAttempts: error.detail?.failedAttempts,
          maxAttempts: error.detail?.maxAttempts,
        },
        { status: 401 }
      );
    }
    throw error;
  }

  // DEVIATION 2 (logAuthEvent §C(f)): emit success event.
  logAuthEvent('password_check', 'success', { userId: session.user?.id, sessionId: session.id });

  const userId = session.user?.id ?? '';
  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(userId),
    provider.getLoginSettings(organization),
  ]);

  // DEVIATION 1 (TOKEN ROTATION — EL Task 6 gate): write the (potentially rotated) session token
  // back to the ceremony cookie. Zitadel may issue a new token on setSession; a stale token
  // would break any subsequent getSession / createCallback / deleteSession call.
  const next = addSession(list, {
    ...entry,
    token: session.token,
    changeTs: session.changedAt,
    expirationTs: session.expiresAt,
  });

  // Derive userVerified and mfaInitSkippedAt from the session/user so the composed
  // nextStep engine can evaluate the full MFA decision tree (passkey UV + enrolled methods).
  const userVerified = session.factors.passkey?.userVerified ?? false;
  const mfaInitSkippedAt = session.user?.mfaInitSkippedAt ?? null;

  const targetUrl = nextStepWithParams({
    factors: session.factors,
    settings,
    enrolledMethods: methods,
    loginName,
    userVerified,
    mfaInitSkippedAt,
    requestId,
    organization,
  });

  // Preserve the /authorize redirect: when nextStep resolves to /signed-in (fully authenticated)
  // and a requestId is present, the session must be finalized via the authorize route instead
  // (which calls createCallback and redirects back to the OIDC client).
  const isSignedIn = targetUrl === '/signed-in' || targetUrl.startsWith('/signed-in?');
  if (isSignedIn && requestId) {
    const authorizeParams = new URLSearchParams({ requestId, sessionId: session.id });
    return redirect(`/authorize?${authorizeParams.toString()}`, {
      headers: { 'set-cookie': await serializeSessions(next) },
    });
  }

  return redirect(targetUrl, {
    headers: { 'set-cookie': await serializeSessions(next) },
  });
}

// client-side validation subset; advisory only (server action's schema is the real gate)
const clientSchema = z.object({ password: z.string().min(1) });

export default function Password() {
  const { csrfToken, loginName, requestId, organization } = useLoaderData<typeof loader>();
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
        schema={clientSchema}
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
