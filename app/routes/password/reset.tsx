import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { requestPasswordReset } from '@/resources/password';
import { resetRequestSchema, resetRequestClientSchema } from '@/resources/password/password.schema';
import { genericCheckYourEmail } from '@/resources/schemas/check-your-email.schema';
import { trustedAppOrigin } from '@/server/app-origin.server';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  data,
  useLoaderData,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Reset password' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  const organization = url.searchParams.get('organization') ?? undefined;
  const provider = providerForRequest(request);
  const branding = await provider.getBranding(organization);
  return data(
    {
      csrfToken,
      branding,
      organization,
      requestId: url.searchParams.get('requestId') ?? undefined,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = resetRequestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const { loginName, organization, requestId } = parsed.data;

  // SECURITY: trustedAppOrigin → PUBLIC_ORIGIN, NEVER the client-controllable request
  // Host header — otherwise an attacker could redirect a victim's reset link (and the
  // real reset code + userId) to their own host. The enumeration-safe dispatch (build
  // template → findUser → conditional send/no-op → single audit event) lives in the
  // service; the route only resolves the trusted origin and renders the response.
  await requestPasswordReset(provider, {
    loginName,
    organization,
    origin: trustedAppOrigin(request),
    requestId,
  });

  // Echoing loginName is safe: the user typed it themselves (not server-derived).
  return genericCheckYourEmail(loginName);
}

export default function PasswordReset() {
  const { csrfToken, organization, requestId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  // On success, swap out the form for the confirmation message
  if (actionData && 'sent' in actionData) {
    return (
      <AuthCard title={<Trans>Check your email</Trans>}>
        <p className="text-foreground text-center text-sm">
          <Trans>We've sent a password reset link to {actionData.email}</Trans>
        </p>
      </AuthCard>
    );
  }

  const serverError =
    actionData && 'error' in actionData && actionData.error === 'INVALID_INPUT'
      ? t`Please enter your email or username.`
      : undefined;

  return (
    <AuthCard title={<Trans>Reset your password</Trans>}>
      <Form.Root
        schema={resetRequestClientSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ loginName: '' }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        {organization ? <input type="hidden" name="organization" value={organization} /> : null}
        {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
        <Form.Field name="loginName" label={t`Email or username`} required>
          <Form.Input
            type="text"
            autoFocus
            autoComplete="username"
            placeholder="email@example.com"
          />
        </Form.Field>
        {serverError ? (
          <p role="alert" className="text-sm text-red-700">
            {serverError}
          </p>
        ) : null}
        <SubmitButton>
          <Trans>Send reset link</Trans>
        </SubmitButton>
      </Form.Root>
    </AuthCard>
  );
}
