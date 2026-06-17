import { nextStepWithParams } from './_shared/next-step-params';
import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import { otpCodeSchema, setupSkipSchema } from '@/flows/mfa-schemas';
import { ProviderError } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
import { readSessions, byLoginName } from '@/session/cookie';
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
import { Form as RRForm } from 'react-router';
import { z } from 'zod';

export const meta: MetaFunction = () => [{ title: 'Set up authenticator app' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;
  const { force, checkAfter } = setupSkipSchema.parse(Object.fromEntries(url.searchParams));

  // Guard: require an active session for this loginName (mirror login.verify.authenticator.tsx).
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return redirect('/login');

  // Resolve userId via findUser — SessionEntry carries no userId field (mirror login.mfa.tsx).
  const provider = providerForRequest(request);
  const user = await provider.findUser(loginName, organization);
  if (!user) return redirect('/login');

  // Register TOTP: returns deterministic { uri, secret } in fake; real adapter generates a new key.
  const { uri, secret } = await provider.registerTotp(user.id);

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data(
    { csrfToken, loginName, requestId, organization, force, checkAfter, uri, secret },
    { headers }
  );
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
      force: z.enum(['true', 'false']).optional(),
      checkAfter: z.enum(['true', 'false']).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const { code, loginName, requestId, organization, checkAfter } = parsed.data;

  // Resolve userId — SessionEntry carries no userId field (mirror login.mfa.tsx).
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });

  const user = await provider.findUser(loginName, organization);
  if (!user) return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });

  const userId = user.id;

  try {
    await provider.verifyTotp(userId, code);
  } catch (err) {
    logAuthEvent('mfa_enroll', 'failure', { userId, factor: 'totp' });
    if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
      return data({ error: 'INVALID_CREDENTIALS' as const }, { status: 401 });
    }
    throw err;
  }

  logAuthEvent('mfa_enroll', 'success', { userId, factor: 'totp' });

  // checkAfter=true: immediately route into the matching verify screen so the
  // user can confirm the newly enrolled factor works.
  if (checkAfter === 'true') {
    const params = new URLSearchParams({ loginName });
    if (requestId) params.set('requestId', requestId);
    if (organization) params.set('organization', organization);
    return redirect(`/login/verify/authenticator?${params.toString()}`);
  }

  // Normal post-enrollment routing: derive next step from current session state.
  const session = await provider.getSession(entry.id, entry.token);
  if (!session) return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });

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

  return redirect(target);
}

const clientSchema = z.object({ code: z.string().min(1) });

export default function SetupAuthenticator() {
  const { csrfToken, loginName, requestId, organization, force, checkAfter, uri, secret } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const serverError =
    actionData && 'error' in actionData
      ? actionData.error === 'INVALID_CREDENTIALS'
        ? t`The code is invalid or has expired. Please try again.`
        : actionData.error === 'SESSION_EXPIRED'
          ? t`Your session has expired. Please sign in again.`
          : t`Please check your input and try again.`
      : undefined;

  return (
    <AuthCard
      title={<Trans>Set up authenticator app</Trans>}
      description={
        <Trans>
          Scan the QR code below with your authenticator app, then enter the 6-digit code to confirm
          enrollment.
        </Trans>
      }>
      <div className="flex flex-col gap-6">
        {/* Manual entry fallback — the otpauth URI and the raw secret.
            NOTE: A rendered QR image would improve UX here. The `qrcode` package
            is not yet in this project's dependency tree; adding it is deferred to a
            follow-up task. The otpauth URI below is scannable by camera apps and
            authenticator apps that accept manual URI import. */}
        <div className="bg-muted flex flex-col gap-2 rounded-md p-4 text-sm">
          <p className="font-medium">
            <Trans>Manual setup key</Trans>
          </p>
          <code
            data-testid="totp-secret"
            className="font-mono text-base tracking-widest break-all select-all">
            {secret}
          </code>
          <p className="mt-2 font-medium">
            <Trans>Or import this URI in your authenticator app</Trans>
          </p>
          <code
            data-testid="totp-uri"
            className="text-foreground font-mono text-xs break-all select-all">
            {uri}
          </code>
        </div>

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
          {force ? <input type="hidden" name="force" value={force} /> : null}
          {checkAfter ? <input type="hidden" name="checkAfter" value={checkAfter} /> : null}
          <Form.Field name="code" label={t`Authenticator code`} required>
            <Form.Input inputMode="numeric" autoComplete="one-time-code" autoFocus />
          </Form.Field>
          {serverError ? (
            <p role="alert" className="text-sm text-red-700">
              {serverError}
            </p>
          ) : null}
          <SubmitButton>
            <Trans>Verify and enable</Trans>
          </SubmitButton>
        </Form.Root>
      </div>
    </AuthCard>
  );
}
