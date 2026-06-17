import { genericCheckYourEmail } from './_schemas/check-your-email';
import { resetRequestSchema } from './_schemas/password';
import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import { verifyUrlTemplate } from '@/flows/verify-url-template';
import { trustedAppOrigin } from '@/routes/_shared/app-origin.server';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
import { constantTimeNoop } from '@/server/timing';
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

  // Build the URL template the provider embeds in the reset email. {{.Code}},
  // {{.UserID}}, {{.OrgID}} are provider-side placeholders Zitadel substitutes when
  // it sends the mail; they must stay RAW (not percent-encoded) or Zitadel leaves
  // them literal in the link. SECURITY: the origin MUST come from trusted config
  // (trustedAppOrigin → PUBLIC_ORIGIN), NEVER the client-controllable request Host
  // header — otherwise an attacker could redirect a victim's reset link (and the
  // real reset code + userId) to their own host. Same class as the /verify fix.
  const urlTemplate = verifyUrlTemplate({
    origin: trustedAppOrigin(request),
    path: '/password/new',
    requestId,
  });

  // ENUMERATION SAFETY: we look up the user and only call sendPasswordReset when
  // found, but BOTH branches emit the SAME audit event and return the IDENTICAL
  // response. An attacker observing responses or logs cannot distinguish a known
  // account from an unknown one.
  const user = await provider.findUser(loginName, organization);
  if (user) {
    await provider.sendPasswordReset(user.id, urlTemplate);
  } else {
    // constantTimeNoop: single-tick yield to avoid a trivial timing difference.
    // Full constant-time hardening (matching sendPasswordReset cost profile) is
    // a Phase 6 item (ENH-01).
    await constantTimeNoop();
  }

  // Same event regardless of branch — never branch audit on account existence.
  logAuthEvent('password.reset.requested', 'success', { loginName });

  // Echoing loginName is safe: the user typed it themselves (not server-derived).
  return genericCheckYourEmail(loginName);
}

// client-side validation subset; advisory only (server action's schema is the real gate)
const clientSchema = resetRequestSchema.pick({ loginName: true });

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
        schema={clientSchema}
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
