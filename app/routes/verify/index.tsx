import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { readSessions, mostRecent } from '@/modules/auth/session/cookie';
import { dispatchEmailCode, resendEmailCode, submitEmailCode } from '@/resources/verify';
import { verifyCodeSchema, verifyCodeClientSchema } from '@/resources/verify/verify.schema';
import { trustedAppOrigin } from '@/server/app-origin.server';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { Button } from '@datum-cloud/datum-ui/button';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  data,
  redirect,
  useLoaderData,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Verify your email' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId') ?? '';
  const send = url.searchParams.get('send') ?? '';
  const invite = url.searchParams.get('invite') ?? undefined;
  const loginName = url.searchParams.get('loginName') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;
  const requestId = url.searchParams.get('requestId') ?? undefined;

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  // CODE-MAJ-08: the email-code dispatch is gated on session ownership inside the
  // service. Resolve the active session from the SIGNED cookie here and hand it in;
  // the service calls getSession to verify it owns `userId` before dispatching.
  if (send === 'true' && userId) {
    const recent = mostRecent(await readSessions(request));
    await dispatchEmailCode(providerForRequest(request), {
      userId,
      // Trusted config origin (PUBLIC_ORIGIN), NOT the request Host header — see
      // trustedAppOrigin; blocks Host-header verification-link injection.
      origin: trustedAppOrigin(request),
      requestId,
      invite: invite === 'true',
      session: recent ? { id: recent.id, token: recent.token } : undefined,
    });
  }

  // Pre-fill the code when the user arrives via the emailed verification link
  // (/verify?code=…&userId=…). The link is the documented continuation path, so the
  // user should land with the field populated and only need to confirm. Typed-in
  // codes (no query param) keep the empty default.
  const code = url.searchParams.get('code') ?? '';

  return data(
    {
      csrfToken,
      userId,
      invite,
      loginName,
      organization,
      requestId,
      code,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const entries = Object.fromEntries(form);

  // Input gate runs BEFORE the intent branch and covers BOTH resend and verify:
  // verifyCodeSchema requires userId.min(1), code.min(1), and invite ∈ {'true','false'}.
  // A malformed/forged POST (empty/missing userId, garbage invite) fails here and never
  // reaches the provider. The rendered resend form always supplies userId + the
  // code='resend' sentinel, so the legitimate flow passes cleanly.
  const parsed = verifyCodeSchema.safeParse(entries);
  if (!parsed.success) {
    return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  }

  const invite = parsed.data.invite === 'true';
  // Trusted config origin (PUBLIC_ORIGIN), NOT the request Host header — see
  // trustedAppOrigin; blocks Host-header verification-link injection.
  const origin = trustedAppOrigin(request);
  const requestId = parsed.data.requestId;

  // Resend intent
  if (form.get('intent') === 'resend') {
    const result = await resendEmailCode(provider, {
      userId: parsed.data.userId,
      origin,
      requestId,
      invite,
    });
    if (!result.ok) {
      return data({ error: result.error }, { status: 400 });
    }
    return data({ notice: result.notice }, { status: 200 });
  }

  // Default verify intent — resolve whether a ceremony session is active from the cookie.
  const hasActiveSession = mostRecent(await readSessions(request)) !== undefined;
  const result = await submitEmailCode(provider, entries, hasActiveSession);
  if (!result.ok) {
    return data({ error: result.error }, { status: 400 });
  }
  return redirect(result.target);
}

export default function Verify() {
  const { csrfToken, userId, invite, loginName, organization, requestId, code } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const serverError =
    actionData && 'error' in actionData
      ? actionData.error === 'INVALID_CREDENTIALS'
        ? t`The code is invalid or has expired. Please request a new one.`
        : t`Please enter your verification code.`
      : undefined;

  return (
    <AuthCard title={<Trans>Verify your email</Trans>}>
      <div className="flex flex-col gap-4">
        <p className="text-foreground text-center text-sm">
          <Trans>Enter the verification code sent to your email address.</Trans>
        </p>

        {/* Primary verify form — datum-ui Form.Root; intent=verify is submitted via SubmitButton */}
        <Form.Root
          schema={verifyCodeClientSchema}
          formComponent={RRForm}
          method="POST"
          defaultValues={{ code }}
          isSubmitting={navigation.state === 'submitting'}
          className="flex flex-col gap-4">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="intent" value="verify" />
          {invite ? <input type="hidden" name="invite" value={invite} /> : null}
          {loginName ? <input type="hidden" name="loginName" value={loginName} /> : null}
          {organization ? <input type="hidden" name="organization" value={organization} /> : null}
          {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          <Form.Field name="code" label={t`Verification code`} required>
            <Form.Input inputMode="numeric" autoComplete="one-time-code" autoFocus />
          </Form.Field>
          {serverError ? (
            <p role="alert" className="text-sm text-red-700">
              {serverError}
            </p>
          ) : null}
          {'notice' in (actionData ?? {}) &&
            'notice' in actionData! &&
            actionData.notice === 'CODE_SENT' && (
              <p role="status" className="text-foreground text-sm">
                <Trans>A new code has been sent to your email.</Trans>
              </p>
            )}
          {'notice' in (actionData ?? {}) &&
            'notice' in actionData! &&
            actionData.notice === 'ALREADY_VERIFIED' && (
              <p role="status" className="text-foreground text-sm">
                <Trans>Your email is already verified. You can sign in.</Trans>
              </p>
            )}
          <SubmitButton>
            <Trans>Verify</Trans>
          </SubmitButton>
        </Form.Root>

        {/* Resend control — plain form so it posts independently of client-side validation.
            The action checks intent=resend before using the code value, but verifyCodeSchema
            requires code.min(1). We use a sentinel value so the schema parse succeeds;
            the resend branch in the action ignores the code entirely. */}
        <form method="post">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="code" value="resend" />
          <input type="hidden" name="intent" value="resend" />
          {invite ? <input type="hidden" name="invite" value={invite} /> : null}
          {loginName ? <input type="hidden" name="loginName" value={loginName} /> : null}
          {organization ? <input type="hidden" name="organization" value={organization} /> : null}
          {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          <Button
            type="secondary"
            theme="outline"
            block
            htmlType="submit"
            loading={navigation.state === 'submitting'}>
            <Trans>Resend code</Trans>
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
