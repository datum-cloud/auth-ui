import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import { readSessions, byLoginName } from '@/modules/auth/session/cookie';
import { setupSkipSchema } from '@/resources/mfa/mfa.schema';
import { enrollTotp } from '@/resources/otp';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
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
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm } from 'react-router';

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

  const formEntries = Object.fromEntries(form);
  const organization = (formEntries.organization as string) || undefined;
  const loginName = (formEntries.loginName as string) ?? '';

  // Resolve the active session entry from the SIGNED cookie (mirror login.mfa.tsx).
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);

  const result = await enrollTotp(provider, formEntries, entry ?? undefined);
  if (!result.ok) {
    const status = result.error === 'INVALID_CREDENTIALS' ? 401 : 400;
    return data({ error: result.error }, { status });
  }

  return redirect(result.target);
}

export default function SetupAuthenticator() {
  const { csrfToken, loginName, requestId, organization, force, checkAfter, uri, secret } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

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
          {force ? <input type="hidden" name="force" value={force} /> : null}
          {checkAfter ? <input type="hidden" name="checkAfter" value={checkAfter} /> : null}
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
              <Trans>Your session has expired. Please sign in again.</Trans>
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
