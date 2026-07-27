// /id/reauth — the sudo interstitial ("Confirm it's you").
//
// Verifies ONE enrolled factor onto the EXISTING session (SetSession semantics via
// reauth.service). Never touches login-decision.ts / next-step routing: on success the
// user returns to the validated returnTo (default /passkeys).
import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { IdpIcon } from '@/components/idp-icon/idp-icon';
import { WebAuthnButton, WebAuthnReasonCopy } from '@/components/webauthn-button/webauthn-button';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { usePasskeyReauthCeremony } from '@/hooks/use-passkey-reauth-ceremony';
import { mostRecent, readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { isStaleSessionError } from '@/modules/auth/types';
import {
  loadReauth,
  performReauth,
  startReauthIdpIntent,
  type ReauthLoadResult,
  type ReauthMethod,
} from '@/resources/reauth/reauth.service';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { validateReturnTo } from '@/resources/shared/return-to';
import { joinLinkedIdps } from '@/resources/sso';
import { getActiveIdPs } from '@/resources/sso/idp-providers';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { actionError } from '@/utils/errors/auth-error';
import { Button, LinkButton } from '@datum-cloud/datum-ui/button';
import { Form } from '@datum-cloud/datum-ui/form';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { cn } from '@datum-cloud/datum-ui/utils';
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

export interface ReauthLoaderData {
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
    consoleUrl: `${env.ZITADEL_API_URL}/ui/console`,
    defaultAppUrl: env.DEFAULT_APP_URL,
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

  if (form.get('intent') === 'idp-reauth') {
    const idpId = String(form.get('idpId') ?? '');
    const returnTo = validateReturnTo(String(form.get('returnTo') ?? '')) ?? paths.passkeys();
    if (!idpId) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

    const sessions = await readSessions(request);
    const entry = mostRecent(sessions);
    if (!entry) return redirect(paths.login.index());

    // Resolve the session's own user — needed to verify idpId is actually linked to
    // THEM, not just any active org provider. Same stale-session recovery loadReauth
    // uses: getSession can throw a non-transient ProviderError for a revoked/stale
    // cross-browser token instead of returning null.
    let userId: string | undefined;
    try {
      const session = await provider.getSession(entry.id, entry.token);
      if (!session) return redirect(paths.login.index());
      userId = session.user?.id ?? (await provider.findUser(entry.loginName))?.id;
      if (!userId) return redirect(paths.login.index());
    } catch (err) {
      if (isStaleSessionError(err)) return redirect(paths.login.index());
      throw err;
    }

    // Defensive server-side re-check: never trust the client's idpId — confirm it
    // resolves to an ACTIVE, non-LDAP provider AND is actually linked to THIS user
    // before starting the round-trip (the chooser only ever shows linked providers;
    // this must match, not just re-check "is some org IdP active"). Scoped to the SAME
    // org loadReauth used to build the chooser's linkedIdps (Task 3).
    const [links, active] = await Promise.all([
      provider.listIdpLinks(userId),
      getActiveIdPs(provider, await resolveOrg(provider, entry.organization)),
    ]);
    const isLinked = joinLinkedIdps(links, active).some(
      (l) => l.idpId === idpId && l.type !== 'LDAP'
    );
    if (!isLinked) {
      return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
    }

    const result = await startReauthIdpIntent(provider, {
      idpId,
      origin: trustedAppOrigin(request),
      returnTo,
    });
    if (!result.ok) return data({ error: result.error }, { status: 502 });
    return redirect(result.authUrl);
  }

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
      consoleUrl: `${env.ZITADEL_API_URL}/ui/console`,
      defaultAppUrl: env.DEFAULT_APP_URL,
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

// The in-place passkey ceremony (usePasskeyReauthCeremony) loads THIS route's own
// loader (?method=passkey) for a challenge via fetcher, then submits the assertion
// to THIS route's action. RR's default post-submit revalidation would re-run the
// loader and mint a FRESH WebAuthn challenge on the Zitadel session, invalidating
// the just-signed assertion mid-flight (same class of bug as WEBAU-3M9si in
// login/passkey.tsx). Suppress ONLY that self-triggered revalidation — the hook
// tags its submit with passkeyCeremony. A full-page visit or retry (no marker)
// revalidates normally, so it always renders a fresh challenge.
export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: {
  formData?: FormData;
  defaultShouldRevalidate: boolean;
}) {
  if (formData?.get('passkeyCeremony') === '1') return false;
  return defaultShouldRevalidate;
}

// ── chooser row ────────────────────────────────────────────────────────────────

function MethodRow({
  href,
  icon,
  children,
  disabled,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  /** Inert while a sibling ceremony (the Passkey row) is busy. */
  disabled?: boolean;
}) {
  // LinkButton (single styled <a>) — NOT Button asChild (nested-interactive axe violation).
  return (
    <LinkButton
      size="large"
      className={cn('h-13 gap-3', disabled && 'pointer-events-none opacity-50')}
      type="quaternary"
      theme="outline"
      block
      as={Link}
      href={href}
      aria-disabled={disabled}
      onClick={(e) => disabled && e.preventDefault()}
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

  const { loginName, methods, method, returnTo, linkedIdps, publicKeyCredentialRequestOptions } =
    view;

  // In-place passkey ceremony — fires from the chooser (method === null) without
  // navigating to the two-step ?method=passkey verify screen below.
  const passkeyCeremony = usePasskeyReauthCeremony({ returnTo });
  const passkeyCeremonyError = useAuthActionError(passkeyCeremony.actionData);
  const passkeyBusy = passkeyCeremony.phase !== 'idle';

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
        <>
          <Trans>For your security, verify one of your sign-in methods to continue.</Trans>
          {loginName && (
            <IdentityBadge
              loginName={loginName}
              verb={<Trans>Logged in as</Trans>}
              linkLabel={<Trans>Not you?</Trans>}
              linkTarget={paths.accounts()}
            />
          )}
        </>
      }>
      {method === null ? (
        <div className="flex flex-col gap-3">
          {passkeyCeremony.reason ? (
            <FormError>
              <WebAuthnReasonCopy reason={passkeyCeremony.reason} />
            </FormError>
          ) : passkeyCeremonyError ? (
            <FormError>{passkeyCeremonyError}</FormError>
          ) : null}
          {methods.includes('passkey') ? (
            // Button (not MethodRow/LinkButton) — fires the ceremony IN PLACE (lazy
            // challenge via fetcher) instead of navigating to ?method=passkey. The
            // chooser stays visible as the fallback on failure.
            <Button
              size="large"
              className="h-13 gap-3"
              type="quaternary"
              theme="outline"
              block
              htmlType="button"
              loading={passkeyBusy}
              onClick={() => passkeyCeremony.begin()}
              iconPosition="left"
              icon={<Icon icon={Key} />}>
              <Trans>Passkey</Trans>
            </Button>
          ) : null}
          {methods.includes('idp') &&
            linkedIdps.map((idp) => (
              <RRForm key={idp.idpId} method="post">
                <AuthFormFields csrf={csrfToken} />
                <input type="hidden" name="intent" value="idp-reauth" />
                <input type="hidden" name="idpId" value={idp.idpId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <Button
                  size="large"
                  className="h-13 gap-3"
                  type="quaternary"
                  theme="outline"
                  block
                  htmlType="submit"
                  disabled={passkeyBusy}
                  iconPosition="left"
                  icon={<IdpIcon type={idp.type} logoUrl={idp.logoUrl} />}>
                  <Trans>Continue with {idp.name ?? idp.idpId}</Trans>
                </Button>
              </RRForm>
            ))}
          {methods.includes('password') ? (
            <MethodRow
              href={paths.reauth({ method: 'password', returnTo })}
              icon={<Icon icon={Lock} />}
              disabled={passkeyBusy}>
              <Trans>Password</Trans>
            </MethodRow>
          ) : null}
          {methods.includes('otp_email') ? (
            <MethodRow
              href={paths.reauth({ method: 'otp_email', returnTo })}
              icon={<Icon icon={Mail} />}
              disabled={passkeyBusy}>
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
