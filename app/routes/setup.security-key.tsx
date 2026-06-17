import { nextStepWithParams } from './_shared/next-step-params';
import { AuthCard } from '@/components/auth-card';
import { WebAuthnButton } from '@/components/webauthn-button';
import { credentialSchema, setupSkipSchema } from '@/flows/mfa-schemas';
import { ProviderError } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
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

export const meta: MetaFunction = () => [{ title: 'Set up security key' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;
  const { force, checkAfter } = setupSkipSchema.parse(Object.fromEntries(url.searchParams));

  // Guard: require an active session for this loginName (mirror setup.passkey.tsx).
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return redirect('/login');

  // Resolve userId via findUser — SessionEntry carries no userId field.
  const provider = providerForRequest(request);
  const user = await provider.findUser(loginName, organization);
  if (!user) return redirect('/login');

  const userId = user.id;
  const domain = url.hostname;

  // Fetch U2F attestation options — degrade gracefully on failure.
  // The WebAuthnButton already shows an inline error when publicKey is null.
  let u2fId: string | null = null;
  let publicKey: unknown = null;
  try {
    const { u2fId: id, publicKeyCredentialCreationOptions } = (await provider.registerU2F(
      userId,
      domain
    )) as { u2fId: string; publicKeyCredentialCreationOptions: unknown };

    u2fId = id;
    // Extract the inner publicKey object for the WebAuthnButton (mirrors login.passkey.tsx pattern).
    publicKey =
      publicKeyCredentialCreationOptions !== null &&
      typeof publicKeyCredentialCreationOptions === 'object' &&
      'publicKey' in (publicKeyCredentialCreationOptions as object)
        ? (publicKeyCredentialCreationOptions as { publicKey: unknown }).publicKey
        : publicKeyCredentialCreationOptions;
  } catch {
    logAuthEvent('mfa_enroll_challenge', 'failure', { loginName, factor: 'u2f' });
    // publicKey stays null — WebAuthnButton surfaces the inline error on click.
  }

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data(
    { csrfToken, loginName, requestId, organization, force, checkAfter, u2fId, publicKey },
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
      u2fId: z.string().min(1),
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
    u2fId,
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

  // Zitadel verifyU2F reads { u2fId, publicKeyCredential, tokenName } off the cred object.
  const credPayload = { u2fId, publicKeyCredential: parsedCredential, tokenName: '' };

  try {
    await provider.verifyU2F(userId, credPayload);
  } catch (err) {
    logAuthEvent('mfa_enroll', 'failure', { userId, factor: 'u2f' });
    if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
      return data({ error: 'INVALID_CREDENTIALS' as const }, { status: 401 });
    }
    throw err;
  }

  logAuthEvent('mfa_enroll', 'success', { userId, factor: 'u2f' });

  // checkAfter=true: immediately route into the matching verify screen.
  if (checkAfter === 'true') {
    const params = new URLSearchParams({ loginName });
    if (requestId) params.set('requestId', requestId);
    if (organization) params.set('organization', organization);
    return redirect(`/login/security-key?${params.toString()}`);
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

export default function SetupSecurityKey() {
  const { csrfToken, loginName, requestId, organization, force, checkAfter, u2fId, publicKey } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const formRef = useRef<HTMLFormElement>(null);
  const { t } = useLingui();

  const serverError =
    actionData && 'error' in actionData
      ? actionData.error === 'INVALID_CREDENTIALS'
        ? t`The security key enrollment failed. Please try again.`
        : actionData.error === 'SESSION_EXPIRED'
          ? t`Your session has expired. Please sign in again.`
          : t`Please try again.`
      : undefined;

  return (
    <AuthCard
      title={<Trans>Set up security key</Trans>}
      description={
        <Trans>
          Register a hardware security key (e.g. YubiKey) as a second factor for your account.
        </Trans>
      }>
      <div className="flex flex-col gap-4">
        {/* Hidden form that WebAuthnButton populates and submits. */}
        <RRForm ref={formRef} method="POST" className="flex flex-col gap-4">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="loginName" value={loginName} />
          <input type="hidden" name="u2fId" value={u2fId ?? ''} />
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

          <WebAuthnButton
            publicKey={publicKey}
            formRef={formRef}
            mode="attestation"
            label={<Trans>Set up security key</Trans>}
          />
        </RRForm>
      </div>
    </AuthCard>
  );
}
