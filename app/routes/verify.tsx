import { verifyCodeSchema } from './_schemas/verify';
import { trustedAppOrigin } from './_shared/app-origin.server';
import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import { verifyUrlTemplate } from '@/flows/verify-url-template';
import { ProviderError } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
import { readSessions, mostRecent } from '@/session/cookie';
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
import { z } from 'zod';

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

  // CODE-MAJ-08: gate the email-code dispatch on session ownership.
  // An unauthenticated GET with ?send=true&userId=<anyone> was previously a code-flood /
  // enumeration vector — any attacker could trigger email sends to arbitrary accounts.
  // Fix: resolve the active session from the cookie and call getSession to get the
  // provider-verified user.id. Only dispatch when the resolved userId matches the query
  // param. Mismatch or no session → silently skip (the manual-submit form still works).
  if (send === 'true' && userId) {
    const provider = providerForRequest(request);

    // Resolve the session cookie and verify ownership server-side via the provider.
    const list = await readSessions(request);
    const recent = mostRecent(list);
    let ownsUser = false;
    if (recent) {
      try {
        const activeSession = await provider.getSession(recent.id, recent.token);
        ownsUser = !!activeSession && activeSession.user?.id === userId;
      } catch {
        // getSession failure → treat as no session (fail closed, do not send)
        ownsUser = false;
      }
    }

    if (ownsUser) {
      try {
        // Raw {{.Code}}/{{.UserID}}/{{.OrgID}} placeholders — Zitadel does NOT decode
        // URL-encoded braces (verified live), so this MUST NOT go through URLSearchParams.
        const urlTemplate = verifyUrlTemplate({
          // Trusted config origin (PUBLIC_ORIGIN), NOT the request Host header — see
          // trustedAppOrigin; blocks Host-header verification-link injection.
          origin: trustedAppOrigin(request),
          requestId,
          invite: invite === 'true',
        });

        if (invite === 'true') {
          // Invite codes use resendEmailCode per the provider interface
          await provider.resendEmailCode(userId, urlTemplate);
        } else {
          await provider.sendEmailCode(userId, urlTemplate);
        }
      } catch (error) {
        // ALREADY_DONE means the user is already verified — swallow gracefully.
        if (error instanceof ProviderError && error.code === 'ALREADY_DONE') {
          // fall through — show the form; the user can proceed to verify or be redirected
        } else {
          throw error;
        }
      }
    }
    // mismatch or no session → silently skip the send (the manual-submit form still works)
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

  const parsed = verifyCodeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const { userId, code, invite, loginName, organization, requestId } = parsed.data;
  const intent = form.get('intent');

  // Build the url template for resend operations. Raw provider placeholders — the
  // helper keeps {{.Code}} etc. unencoded (Zitadel won't decode %7B%7B...).
  const urlTemplate = verifyUrlTemplate({
    // Trusted config origin (PUBLIC_ORIGIN), NOT the request Host header — see
    // trustedAppOrigin; blocks Host-header verification-link injection.
    origin: trustedAppOrigin(request),
    requestId,
    invite: invite === 'true',
  });

  // Resend intent
  if (intent === 'resend') {
    try {
      await provider.resendEmailCode(userId, urlTemplate);
      return data({ notice: 'CODE_SENT' as const }, { status: 200 });
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'ALREADY_DONE') {
        return data({ notice: 'ALREADY_VERIFIED' as const }, { status: 200 });
      }
      throw error;
    }
  }

  // Default verify intent
  try {
    if (invite === 'true') {
      await provider.verifyInvite(userId, code);
    } else {
      await provider.verifyEmail(userId, code);
    }
    logAuthEvent(invite === 'true' ? 'invite.verified' : 'email.verified', 'success', { userId });

    // Resolve the active ceremony session from the cookie
    const sessions = await readSessions(request);
    const active = mostRecent(sessions);

    if (active && requestId) {
      return redirect(`/authorize?requestId=${requestId}`);
    }
    if (active) {
      return redirect('/signed-in');
    }

    // No active session — send to success page
    const successParams = new URLSearchParams();
    if (loginName) successParams.set('loginName', loginName);
    if (requestId) successParams.set('requestId', requestId);
    if (organization) successParams.set('organization', organization);
    return redirect(`/verify/success?${successParams}`);
  } catch (error) {
    logAuthEvent(invite === 'true' ? 'invite.verified' : 'email.verified', 'failure', { userId });
    if (error instanceof ProviderError && error.code === 'INVALID_CREDENTIALS') {
      return data({ error: 'INVALID_CREDENTIALS' as const }, { status: 400 });
    }
    throw error;
  }
}

// Client-side validation: only the code field (userId etc. come from hidden inputs)
const clientSchema = z.object({ code: z.string().min(1) });

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
          schema={clientSchema}
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
