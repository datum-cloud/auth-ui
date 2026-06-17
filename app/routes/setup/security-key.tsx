import { AuthCard } from '@/components/auth-card/auth-card';
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { credentialSchema, setupSkipSchema } from '@/resources/mfa/mfa.schema';
import { requestU2FAttestation, verifyU2FEnrollment } from '@/resources/webauthn';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { readSessions } from '@/modules/auth/session/cookie';
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

  const provider = providerForRequest(request);
  const sessions = await readSessions(request);

  const result = await requestU2FAttestation(provider, sessions, {
    loginName,
    organization,
    domain: url.hostname,
  });
  if (result.kind === 'redirect') return redirect(result.target);

  // Extract the inner publicKey object for the WebAuthnButton (mirrors login.passkey.tsx pattern).
  const { publicKeyCredentialCreationOptions } = result;
  const publicKey =
    publicKeyCredentialCreationOptions !== null &&
    typeof publicKeyCredentialCreationOptions === 'object' &&
    'publicKey' in (publicKeyCredentialCreationOptions as object)
      ? (publicKeyCredentialCreationOptions as { publicKey: unknown }).publicKey
      : publicKeyCredentialCreationOptions;

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
      u2fId: result.u2fId,
      publicKey,
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

  const sessions = await readSessions(request);
  const result = await verifyU2FEnrollment(provider, sessions, {
    credential: credentialJson,
    u2fId,
    loginName,
    requestId,
    organization,
    checkAfter,
  });

  if (!result.ok) {
    const status = result.error === 'INVALID_CREDENTIALS' ? 401 : 400;
    return data({ error: result.error }, { status });
  }

  return redirect(result.target);
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
