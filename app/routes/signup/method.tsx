import { AuthCard } from '@/components/auth-card/auth-card';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { genericCheckYourEmail } from '@/resources/schemas/check-your-email.schema';
import {
  passwordFirstHandoff,
  registerPasskeyFirst,
  registerEmailLinkSignup,
} from '@/resources/signup';
import { resolveSignupView } from '@/resources/signup/signup-view';
import { signupMethodSchema } from '@/resources/signup/signup.schema';
import { trustedAppOrigin } from '@/server/app-origin.server';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { requireEmailVerification } from '@/server/env';
import { env } from '@/utils/env/env.server';
import { actionError } from '@/utils/errors/auth-error';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
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

export const meta: MetaFunction = () => [{ title: 'Finish creating your account' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);

  const loginName = url.searchParams.get('loginName') ?? '';
  const firstName = url.searchParams.get('firstName') ?? '';
  const lastName = url.searchParams.get('lastName') ?? '';
  const organization = url.searchParams.get('organization') ?? undefined;
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const deviceTrackingToken = url.searchParams.get('deviceTrackingToken') ?? undefined;

  const [settings, idps] = await Promise.all([
    provider.getLoginSettings(organization),
    provider.capabilities.externalIdp ? provider.getActiveIdPs(organization) : Promise.resolve([]),
  ]);
  const view = resolveSignupView(settings, idps, env.AUTH_EMAIL_DELIVERY_ENABLED);

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data(
    {
      csrfToken,
      loginName,
      firstName,
      lastName,
      organization,
      requestId,
      deviceTrackingToken,
      view,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = signupMethodSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const { intent, loginName, firstName, lastName, organization, requestId, deviceTrackingToken } =
    parsed.data;

  if (intent === 'email-link') {
    if (!env.AUTH_EMAIL_DELIVERY_ENABLED)
      return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
    try {
      const result = await registerEmailLinkSignup(provider, await readSessions(request), {
        email: loginName,
        firstName,
        lastName,
        organization,
        requestId,
        origin: trustedAppOrigin(request),
        deviceTrackingToken,
      });
      return genericCheckYourEmail(result.email);
    } catch (err) {
      return actionError(err);
    }
  }

  if (intent === 'passkey') {
    try {
      const result = await registerPasskeyFirst(provider, await readSessions(request), {
        email: loginName,
        firstName,
        lastName,
        organization,
        requestId,
        deviceTrackingToken,
        // Verify email first (anti-spam): a passkey proves device possession, not email
        // ownership, so enrollment is gated behind email verification. With EMAIL_VERIFICATION
        // on (the default), a brand-new email gets the 'sent-with-session' result below
        // (→ "Check your email"); an existing email returns the enumeration-safe 'sent',
        // indistinguishable from a new one. Only EMAIL_VERIFICATION=false routes straight to
        // /setup/passkey via the 'redirect' branch.
        requireVerification: requireEmailVerification(),
        origin: trustedAppOrigin(request),
      });

      if (result.kind === 'sent') return genericCheckYourEmail(result.email);
      if (result.kind === 'sent-with-session') {
        return data(
          { sent: true as const, email: result.email },
          { status: 200, headers: { 'set-cookie': await serializeSessions(result.sessions) } }
        );
      }
      // kind === 'redirect'
      return redirect(result.target, {
        headers: { 'set-cookie': await serializeSessions(result.sessions) },
      });
    } catch (err) {
      return actionError(err);
    }
  }

  // intent === 'password'
  const result = passwordFirstHandoff({
    email: loginName,
    firstName,
    lastName,
    organization,
    requestId,
    deviceTrackingToken,
  });
  return redirect(result.target);
}

// ── Shared hidden fields carried in every method form ──────────────────────────

interface HiddenContextProps {
  csrf: string;
  loginName: string;
  firstName: string;
  lastName: string;
  organization?: string;
  requestId?: string;
  deviceTrackingToken?: string;
}

function HiddenContext({
  csrf,
  loginName,
  firstName,
  lastName,
  organization,
  requestId,
  deviceTrackingToken,
}: HiddenContextProps) {
  return (
    <>
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="loginName" value={loginName} />
      <input type="hidden" name="firstName" value={firstName} />
      <input type="hidden" name="lastName" value={lastName} />
      {organization ? <input type="hidden" name="organization" value={organization} /> : null}
      {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
      {deviceTrackingToken ? (
        <input type="hidden" name="deviceTrackingToken" value={deviceTrackingToken} />
      ) : null}
    </>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function SignupMethod() {
  const {
    csrfToken,
    loginName,
    firstName,
    lastName,
    organization,
    requestId,
    deviceTrackingToken,
    view,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state !== 'idle';

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

  // Enumeration-safe terminal: the email-link path (and an existing-email passkey/IdP
  // attempt) returns a generic "check your email" — render it here, otherwise the screen
  // would silently re-render with no feedback.
  if (actionData && 'sent' in actionData) {
    return (
      <AuthCard
        title={<Trans>Check your email</Trans>}
        description={
          <Trans>
            We've sent a verification link to{' '}
            <strong>{(actionData as { email: string }).email}</strong>
          </Trans>
        }></AuthCard>
    );
  }

  const contextProps: HiddenContextProps = {
    csrf: csrfToken,
    loginName,
    firstName,
    lastName,
    organization,
    requestId,
    deviceTrackingToken,
  };

  return (
    <AuthCard
      title={<Trans>Finish creating your account</Trans>}
      description={
        <>
          {firstName} {lastName} · {loginName}
        </>
      }>
      <div className="flex flex-col gap-3">
        {/* Email-link (passwordless) — always shown when email entry is allowed */}
        {view.showEmailLink ? (
          <RRForm method="post">
            <HiddenContext {...contextProps} />
            <input type="hidden" name="intent" value="email-link" />
            <Button
              size="large"
              className="h-13"
              type="quaternary"
              theme="outline"
              block
              htmlType="submit"
              loading={submitting && navigation.formData?.get('intent') === 'email-link'}>
              <Trans>Email me a sign-in link</Trans>
            </Button>
          </RRForm>
        ) : null}

        {/* Passkey */}
        {view.showPasskey ? (
          <RRForm method="post">
            <HiddenContext {...contextProps} />
            <input type="hidden" name="intent" value="passkey" />
            <Button
              size="large"
              className="h-13"
              type="quaternary"
              theme="outline"
              block
              htmlType="submit"
              loading={submitting && navigation.formData?.get('intent') === 'passkey'}>
              <Trans>Use a passkey</Trans>
            </Button>
          </RRForm>
        ) : null}

        {/* Password */}
        {view.showPassword ? (
          <RRForm method="post">
            <HiddenContext {...contextProps} />
            <input type="hidden" name="intent" value="password" />
            <Button
              size="large"
              className="h-13"
              type="quaternary"
              theme="outline"
              block
              htmlType="submit"
              loading={submitting && navigation.formData?.get('intent') === 'password'}>
              <Trans>Set a password</Trans>
            </Button>
          </RRForm>
        ) : null}
      </div>
    </AuthCard>
  );
}
