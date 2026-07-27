// /id/reauth — the sudo interstitial ("Confirm it's you").
//
// Verifies ONE enrolled factor onto the EXISTING session (SetSession semantics via
// reauth.service). Never touches login-decision.ts / next-step routing: on success the
// user returns to the validated returnTo (default /passkeys).
import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import {
  loadReauth,
  performReauth,
  type ReauthLoadResult,
  type ReauthMethod,
} from '@/resources/reauth/reauth.service';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { env } from '@/server/infra/env.server';
import { actionError } from '@/utils/errors/auth-error';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Form } from '@datum-cloud/datum-ui/form';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans, useLingui } from '@lingui/react/macro';
import { Key, Lock, Mail } from 'lucide-react';
import { useRef } from 'react';
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

export const meta: MetaFunction = () => [{ title: "Confirm it's you" }];

const METHOD_PARAMS = ['passkey', 'password', 'otp_email'] as const;

type ReauthView = Extract<ReauthLoadResult, { kind: 'view' }>;

interface ReauthLoaderData {
  csrfToken: string;
  view: ReauthView;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const rawMethod = url.searchParams.get('method');
  const method = (METHOD_PARAMS as readonly string[]).includes(rawMethod ?? '')
    ? (rawMethod as ReauthMethod)
    : null;

  const provider = providerForRequest(request);
  const sessions = await readSessions(request);

  const result = await loadReauth(provider, sessions, {
    returnTo: url.searchParams.get('returnTo'),
    method,
    domain: url.hostname,
    emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
  });
  if (result.kind === 'redirect') return redirect(result.target);

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data<ReauthLoaderData>({ csrfToken, view: result }, { headers });
}

const reauthActionSchema = z.object({
  factor: z.enum(['passkey', 'password', 'otp_email']),
  password: z.string().optional(),
  code: z.string().optional(),
  credential: z.string().optional(),
  returnTo: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = reauthActionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const sessions = await readSessions(request);
  try {
    const result = await performReauth(provider, sessions, {
      factor: parsed.data.factor,
      password: parsed.data.password,
      code: parsed.data.code,
      credential: parsed.data.credential,
      returnTo: parsed.data.returnTo ?? null,
    });
    if (!result.ok) {
      const status = result.error === 'INVALID_CREDENTIALS' ? 401 : 400;
      return data({ error: result.error }, { status });
    }
    return redirect(result.target, {
      headers: { 'set-cookie': await serializeSessions(result.sessions) },
    });
  } catch (err) {
    return actionError(err);
  }
}

// ── chooser row ────────────────────────────────────────────────────────────────

function MethodRow({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  // LinkButton (single styled <a>) — NOT Button asChild (nested-interactive axe violation).
  return (
    <LinkButton
      size="large"
      className="h-13 gap-3"
      type="quaternary"
      theme="outline"
      block
      as={Link}
      href={href}
      iconPosition="left"
      icon={icon}>
      {children}
    </LinkButton>
  );
}

export default function Reauth() {
  const { csrfToken, view } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();
  const formRef = useRef<HTMLFormElement>(null);
  const errorMessage = useAuthActionError(actionData);

  const { methods, method, returnTo, publicKeyCredentialRequestOptions } = view;

  // Extract the inner publicKey object that marshalAssertion expects.
  const publicKey =
    publicKeyCredentialRequestOptions !== null &&
    typeof publicKeyCredentialRequestOptions === 'object' &&
    'publicKey' in (publicKeyCredentialRequestOptions as object)
      ? (publicKeyCredentialRequestOptions as { publicKey: unknown }).publicKey
      : publicKeyCredentialRequestOptions;

  return (
    <AuthCard
      title={<Trans>Confirm it's you</Trans>}
      description={
        <Trans>For your security, verify one of your sign-in methods to continue.</Trans>
      }>
      {method === null ? (
        <div className="flex flex-col gap-3">
          {methods.includes('passkey') ? (
            <MethodRow
              href={paths.reauth({ method: 'passkey', returnTo })}
              icon={<Icon icon={Key} />}>
              <Trans>Passkey</Trans>
            </MethodRow>
          ) : null}
          {methods.includes('password') ? (
            <MethodRow
              href={paths.reauth({ method: 'password', returnTo })}
              icon={<Icon icon={Lock} />}>
              <Trans>Password</Trans>
            </MethodRow>
          ) : null}
          {methods.includes('otp_email') ? (
            <MethodRow
              href={paths.reauth({ method: 'otp_email', returnTo })}
              icon={<Icon icon={Mail} />}>
              <Trans>Email me a code</Trans>
            </MethodRow>
          ) : null}
          {methods.length === 0 ? (
            <FormError>
              <Trans>No sign-in method is available for re-authentication.</Trans>
            </FormError>
          ) : null}
        </div>
      ) : method === 'passkey' ? (
        // Hidden form that WebAuthnButton populates and submits.
        <RRForm ref={formRef} method="POST" className="flex w-full flex-col gap-4">
          <AuthFormFields csrf={csrfToken} />
          <input type="hidden" name="factor" value="passkey" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="credential" defaultValue="" />
          {errorMessage ? <FormError>{errorMessage}</FormError> : null}
          <WebAuthnButton publicKey={publicKey} formRef={formRef} />
        </RRForm>
      ) : method === 'password' ? (
        <Form.Root
          schema={z.object({ password: z.string().min(1) })}
          formComponent={RRForm}
          method="POST"
          defaultValues={{ password: '' }}
          isSubmitting={navigation.state === 'submitting'}
          className="flex w-full flex-col gap-4">
          <AuthFormFields csrf={csrfToken} />
          <input type="hidden" name="factor" value="password" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Form.Field name="password" label={t`Password`} required>
            <Form.Input type="password" autoFocus autoComplete="current-password" />
          </Form.Field>
          <FormError>{errorMessage}</FormError>
          <SubmitButton>
            <Trans>Confirm</Trans>
          </SubmitButton>
        </Form.Root>
      ) : (
        <Form.Root
          schema={z.object({ code: z.string().min(1) })}
          formComponent={RRForm}
          method="POST"
          defaultValues={{ code: '' }}
          isSubmitting={navigation.state === 'submitting'}
          className="flex w-full flex-col gap-4">
          <AuthFormFields csrf={csrfToken} />
          <input type="hidden" name="factor" value="otp_email" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <p className="text-foreground/80 text-center text-sm">
            <Trans>We sent a verification code to your email address.</Trans>
          </p>
          <Form.Field name="code" label={t`Verification code`} required>
            <Form.Input autoFocus autoComplete="one-time-code" />
          </Form.Field>
          <FormError>{errorMessage}</FormError>
          <SubmitButton>
            <Trans>Confirm</Trans>
          </SubmitButton>
        </Form.Root>
      )}
    </AuthCard>
  );
}
