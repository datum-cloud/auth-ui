import { nextStepWithParams } from './_shared/next-step-params';
import { AuthCard } from '@/components/auth-card';
import { WebAuthnButton } from '@/components/webauthn-button';
import { credentialSchema, setupSkipSchema } from '@/flows/mfa-schemas';
import { ProviderError } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent, hashActor } from '@/server/observability';
import { readSessions, byLoginName } from '@/session/cookie';
import { Trans, useLingui } from '@lingui/react/macro';
import { useRef } from 'react';
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm } from 'react-router';
import { z } from 'zod';

export const meta: MetaFunction = () => [{ title: 'Set up passkey' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;
  const { force, checkAfter } = setupSkipSchema.parse(Object.fromEntries(url.searchParams));

  // Guard: require an active session for this loginName (mirror setup.authenticator.tsx).
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return redirect('/login');

  // Resolve userId via findUser — SessionEntry carries no userId field.
  const provider = providerForRequest(request);
  const user = await provider.findUser(loginName, organization);
  if (!user) return redirect('/login');

  const userId = user.id;
  const domain = url.hostname;

  // Steps 1–2: get a registration link then fetch attestation options.
  // On failure (provider unreachable, token expired, etc.) degrade gracefully — the
  // WebAuthnButton already shows an inline error when publicKey is null.
  let passkeyId: string | null = null;
  let publicKey: unknown = null;
  let challengeFailed = false;
  try {
    const { code } = await provider.passkeyRegisterLink(userId);
    const { passkeyId: id, publicKeyCredentialCreationOptions } = (await provider.registerPasskey(
      userId,
      code,
      domain
    )) as { passkeyId: string; publicKeyCredentialCreationOptions: unknown };

    passkeyId = id;
    // Extract the inner publicKey object for the WebAuthnButton (mirrors login.passkey.tsx pattern).
    publicKey =
      publicKeyCredentialCreationOptions !== null &&
      typeof publicKeyCredentialCreationOptions === 'object' &&
      'publicKey' in (publicKeyCredentialCreationOptions as object)
        ? (publicKeyCredentialCreationOptions as { publicKey: unknown }).publicKey
        : publicKeyCredentialCreationOptions;
  } catch (err) {
    // CODE-MIN-29: don't discard the cause — log a typed code and a pseudonymized actor (CCD-9).
    logAuthEvent('mfa_enroll_challenge', 'failure', {
      actor: hashActor(loginName),
      factor: 'passkey',
      code: err instanceof ProviderError ? err.code : 'UNKNOWN',
    });
    // Surface a visible enrollment-failure state so the screen can warn before the user clicks.
    challengeFailed = true;
    // publicKey stays null — WebAuthnButton also surfaces the inline error on click.
  }

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data(
    {
      csrfToken,
      loginName,
      requestId,
      organization,
      force,
      checkAfter,
      passkeyId,
      publicKey,
      challengeFailed,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = z
    .object({
      credential: credentialSchema.shape.credential,
      passkeyId: z.string().min(1),
      loginName: z.string().min(1),
      requestId: z.string().optional(),
      organization: z.string().optional(),
      force: z.enum(['true', 'false']).optional(),
      checkAfter: z.enum(['true', 'false']).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const {
    credential: credentialJson,
    passkeyId,
    loginName,
    requestId,
    organization,
    checkAfter,
  } = parsed.data;

  // Resolve userId.
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });

  const user = await provider.findUser(loginName, organization);
  if (!user) return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });

  const userId = user.id;

  let parsedCredential: unknown;
  try {
    parsedCredential = JSON.parse(credentialJson) as unknown;
  } catch {
    return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  }

  try {
    await provider.verifyPasskey(userId, passkeyId, parsedCredential);
  } catch (err) {
    logAuthEvent('mfa_enroll', 'failure', { userId, factor: 'passkey' });
    if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
      return data({ error: 'INVALID_CREDENTIALS' as const }, { status: 401 });
    }
    throw err;
  }

  logAuthEvent('mfa_enroll', 'success', { userId, factor: 'passkey' });

  // checkAfter=true: immediately route into the matching verify screen.
  if (checkAfter === 'true') {
    const params = new URLSearchParams({ loginName });
    if (requestId) params.set('requestId', requestId);
    if (organization) params.set('organization', organization);
    return redirect(`/login/passkey?${params.toString()}`);
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

export default function SetupPasskey() {
  const {
    csrfToken,
    loginName,
    requestId,
    organization,
    force,
    checkAfter,
    passkeyId,
    publicKey,
    challengeFailed,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const formRef = useRef<HTMLFormElement>(null);
  const { t } = useLingui();

  const serverError =
    actionData && 'error' in actionData
      ? actionData.error === 'INVALID_CREDENTIALS'
        ? t`The passkey enrollment failed. Please try again.`
        : actionData.error === 'SESSION_EXPIRED'
          ? t`Your session has expired. Please sign in again.`
          : t`Please try again.`
      : undefined;

  return (
    <AuthCard
      title={<Trans>Set up passkey</Trans>}
      description={
        <Trans>
          Register a passkey using your device's biometric sensor or PIN to sign in securely without
          a password.
        </Trans>
      }>
      <div className="flex flex-col gap-4">
        {/* Hidden form that WebAuthnButton populates and submits. */}
        <RRForm ref={formRef} method="POST" className="flex flex-col gap-4">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="loginName" value={loginName} />
          <input type="hidden" name="passkeyId" value={passkeyId ?? ''} />
          {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          {organization ? <input type="hidden" name="organization" value={organization} /> : null}
          {force ? <input type="hidden" name="force" value={force} /> : null}
          {checkAfter ? <input type="hidden" name="checkAfter" value={checkAfter} /> : null}
          {/* credential is populated by WebAuthnButton before submit */}
          <input type="hidden" name="credential" defaultValue="" />

          {serverError ? (
            <p role="alert" className="text-sm text-red-700">
              {serverError}
            </p>
          ) : null}

          {/* CODE-MIN-29: the loader couldn't fetch an attestation challenge — warn up front
              with enrollment-specific copy (distinct from the assertion verification error). */}
          {challengeFailed ? (
            <p role="alert" className="text-sm text-red-700">
              <Trans>We couldn't start passkey setup. Please try again.</Trans>
            </p>
          ) : null}

          <WebAuthnButton
            publicKey={publicKey}
            formRef={formRef}
            mode="attestation"
            label={<Trans>Register passkey</Trans>}
          />
        </RRForm>
      </div>
    </AuthCard>
  );
}
