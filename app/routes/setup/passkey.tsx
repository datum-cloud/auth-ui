import { AuthCard } from '@/components/auth-card/auth-card';
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import { readSessions } from '@/modules/auth/session/cookie';
import { credentialSchema, setupSkipSchema } from '@/resources/mfa/mfa.schema';
import { requestPasskeyAttestation, verifyPasskeyEnrollment } from '@/resources/webauthn';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
import { Trans } from '@lingui/react/macro';
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

  const provider = providerForRequest(request);
  const sessions = await readSessions(request);

  const result = await requestPasskeyAttestation(provider, sessions, {
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
      passkeyId: result.passkeyId,
      publicKey,
      challengeFailed: result.challengeFailed,
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

  const sessions = await readSessions(request);
  const result = await verifyPasskeyEnrollment(provider, sessions, {
    credential: credentialJson,
    passkeyId,
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

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

  return (
    <AuthCard
      title={<Trans>Set up passkey</Trans>}
      description={
        <Trans>
          Register a passkey using your device's biometric sensor or PIN to sign in securely without
          a password.
        </Trans>
      }>
      <div className="flex w-full flex-col gap-4">
        {/* Hidden form that WebAuthnButton populates and submits. */}
        <RRForm ref={formRef} method="POST" className="flex w-full flex-col gap-4">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="loginName" value={loginName} />
          <input type="hidden" name="passkeyId" value={passkeyId ?? ''} />
          {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          {organization ? <input type="hidden" name="organization" value={organization} /> : null}
          {force ? <input type="hidden" name="force" value={force} /> : null}
          {checkAfter ? <input type="hidden" name="checkAfter" value={checkAfter} /> : null}
          {/* credential is populated by WebAuthnButton before submit */}
          <input type="hidden" name="credential" defaultValue="" />

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
