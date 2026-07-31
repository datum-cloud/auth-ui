import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { useLoginContext } from '@/hooks/use-login-context';
// ADAPTATION (plan-drift fix): readSessions/serializeSessions live in @/modules/auth/session/cookie
// (which re-exports them from session.ts) — the canonical one-stop import for route-layer session I/O.
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { serializeLastUsedLogin } from '@/modules/auth/session/last-used-login';
import { serializePasskeyHint } from '@/modules/auth/session/passkey-hint';
import { checkReauthIntent } from '@/modules/auth/session/reauth-intent';
import { verifyLoginPassword } from '@/resources/login';
import { attemptsRemaining } from '@/resources/login/login-view';
import { loginPasswordSchema, loginPasswordClientSchema } from '@/resources/login/login.schema';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { redirectToLogin } from '@/routes/login-bounce';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
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

export const meta: MetaFunction = () => [{ title: 'Enter your password' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const organization = url.searchParams.get('organization') ?? undefined;
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const provider = providerForRequest(request);
  // Org-first: an explicit org wins, else the default org (old app's `organization ?? getDefaultOrg()`).
  const settings = await provider.getLoginSettings(await resolveOrg(provider, organization));
  // Org policy may forbid password entirely (Zitadel LoginPolicy.userLogin=false — production's
  // configuration). decideAfterIdentifier already filters password out of the post-identifier
  // routing, so nothing NAVIGATES here; but LoginPolicy governs Zitadel's own hosted UI, not
  // auth-ui's headless Session API calls — without this a direct visit renders a working form.
  if (!settings.allowPassword) return redirect(redirectToLogin(requestId, organization));
  const { csrfToken, headers } = await loaderCsrf(request);
  return data({ csrfToken, hidePasswordReset: settings.hidePasswordReset === true }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);
  const parsed = loginPasswordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  const { password, loginName, requestId, organization } = parsed.data;

  // Same policy guard as the loader, repeated because a crafted POST never runs the loader.
  // Not belt-and-braces: Zitadel's Session API password check does NOT consult LoginPolicy,
  // so without this a direct POST would authenticate against a policy that forbids passwords.
  const settings = await provider.getLoginSettings(await resolveOrg(provider, organization));
  if (!settings.allowPassword) {
    return data({ error: 'PASSWORD_NOT_ALLOWED' as const }, { status: 403 });
  }

  const list = await readSessions(request);
  const result = await verifyLoginPassword(provider, list, {
    password,
    loginName,
    requestId,
    organization,
  });

  if (!result.ok) {
    if (result.error === 'SESSION_EXPIRED') {
      // Dead-session recovery (see login.service.ts): when the stale entry was pruned, thread
      // the pruned list back into the cookie so the browser actually drops it — otherwise the
      // same dead entry would keep shadowing the fresh one on every retry.
      const headers = new Headers();
      if (result.sessions) {
        headers.append('set-cookie', await serializeSessions(result.sessions));
      }
      return data({ error: 'SESSION_EXPIRED' as const }, { status: 400, headers });
    }
    return data(
      {
        error: 'INVALID_CREDENTIALS' as const,
        failedAttempts: result.failedAttempts,
        maxAttempts: result.maxAttempts,
      },
      { status: 401 }
    );
  }

  const headers = new Headers();
  headers.append('set-cookie', await serializeSessions(result.sessions));
  headers.append('set-cookie', await serializeLastUsedLogin('email'));
  headers.append('set-cookie', await serializePasskeyHint(loginName));

  // RE-AUTH identity guard (password path) — shared checkReauthIntent so all factors agree. When
  // this login is re-authenticating a specific account, verify the identity that authenticated
  // matches (case-insensitive). The intent marker is cleared either way; on a MISMATCH we don't
  // continue the ceremony as the typed-in different identity — keep both accounts and bounce to
  // the picker so the user chooses.
  const reauth = await checkReauthIntent(request, loginName);
  if (reauth.clearCookie) headers.append('set-cookie', reauth.clearCookie);
  if (reauth.mismatch) {
    const params = new URLSearchParams({ reauthMismatch: '1' });
    if (requestId) params.set('requestId', requestId);
    return redirect(`${paths.accounts()}?${params.toString()}`, { headers });
  }

  return redirect(result.target, { headers });
}

export default function Password() {
  const { csrfToken, hidePasswordReset } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useLoginContext();
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

  const attempts =
    serverError?.kind === 'INVALID_CREDENTIALS'
      ? attemptsRemaining(serverError.failedAttempts, serverError.maxAttempts)
      : null;

  // paths.password.reset emits the identical query string (requestId, then
  // organization — undefined values skipped, no trailing "?" when both absent).
  const resetHref = paths.password.reset({ requestId, organization });

  return (
    <AuthCeremony
      title={<Trans>Enter your password</Trans>}
      loginName={loginName}
      requestId={requestId}
      organization={organization}>
      <Form.Root
        schema={loginPasswordClientSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ password: '' }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex w-full flex-col gap-4">
        <AuthFormFields
          csrf={csrfToken}
          loginName={loginName}
          requestId={requestId}
          organization={organization}
        />
        <Form.Field name="password" label={t`Enter your password`} required>
          <Form.Input type="password" autoComplete="current-password" autoFocus />
        </Form.Field>

        {serverError?.kind === 'INVALID_CREDENTIALS' && (
          <FormError>
            {serverError.message}
            {attempts?.kind === 'locked' ? (
              <>
                {' '}
                <Trans>Your account is temporarily locked after too many attempts.</Trans>
              </>
            ) : attempts?.kind === 'remaining' ? (
              <>
                {' '}
                <Plural
                  value={attempts.count}
                  one="# attempt remaining."
                  other="# attempts remaining."
                />
              </>
            ) : null}
          </FormError>
        )}
        {serverError?.kind === 'SESSION_EXPIRED' && (
          <FormError>
            <Trans>Your session has expired.</Trans>{' '}
            <Link to={redirectToLogin(requestId, organization)} className="underline">
              <Trans>Sign in again</Trans>
            </Link>
          </FormError>
        )}
        {serverError?.kind === 'INVALID_INPUT' && (
          <FormError>
            <Trans>Please check your input and try again.</Trans>
          </FormError>
        )}

        <SubmitButton>
          <Trans>Sign in</Trans>
        </SubmitButton>
      </Form.Root>

      {!hidePasswordReset ? (
        <p className="mt-4 text-center text-sm">
          <Link to={resetHref} className="text-muted-foreground underline">
            <Trans>Forgot password?</Trans>
          </Link>
        </p>
      ) : null}
    </AuthCeremony>
  );
}
