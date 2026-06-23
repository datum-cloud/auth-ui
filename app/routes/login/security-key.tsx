import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import {
  createWebAuthnVerifyHandlers,
  type WebAuthnVerifyActionData,
  type WebAuthnVerifyLoaderData,
} from '@/resources/webauthn/webauthn-verify';
import { Trans } from '@lingui/react/macro';
import { useRef } from 'react';
import { useActionData, useLoaderData, type MetaFunction } from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Verify with security key' }];

// Security key: userVerification DISCOURAGED (vs passkey which uses REQUIRED).
// Individual named exports are required by the React Router Vite plugin — it
// cannot tree-shake a destructured const export from a factory call.
const _handlers = createWebAuthnVerifyHandlers({
  userVerificationRequirement: 'discouraged',
  auditEvent: 'mfa_u2f',
  challengeAuditEvent: 'mfa_u2f_challenge',
});
export const loader = _handlers.loader;
export const action = _handlers.action;

export default function LoginSecurityKey() {
  // React Router 7 cannot infer `typeof loader` through the factory return value,
  // so we use the exported concrete type instead of `useLoaderData<typeof loader>()`.
  const { csrfToken, loginName, requestId, organization, publicKeyCredentialRequestOptions } =
    useLoaderData() as WebAuthnVerifyLoaderData;
  // React Router 7 cannot infer `typeof action` through a factory return — resolves to `never`.
  // Use the exported concrete type instead.
  const actionData = useActionData() as WebAuthnVerifyActionData | undefined;
  const formRef = useRef<HTMLFormElement>(null);

  // Extract the inner publicKey object that marshalAssertion expects.
  const publicKey =
    publicKeyCredentialRequestOptions !== null &&
    typeof publicKeyCredentialRequestOptions === 'object' &&
    'publicKey' in (publicKeyCredentialRequestOptions as object)
      ? (publicKeyCredentialRequestOptions as { publicKey: unknown }).publicKey
      : publicKeyCredentialRequestOptions;

  // Shared error pipeline; the message now surfaces inline through AuthCeremony.
  const errorMessage = useAuthActionError(actionData);

  return (
    <AuthCeremony
      title={<Trans>Verify with security key</Trans>}
      description={<Trans>Use your security key to verify your identity.</Trans>}
      error={errorMessage}
      loginName={loginName}
      requestId={requestId}
      organization={organization}>
      {/* Hidden form that WebAuthnButton populates and submits. */}
      <RRForm ref={formRef} method="POST" className="flex w-full flex-col gap-4">
        <AuthFormFields
          csrf={csrfToken}
          loginName={loginName}
          requestId={requestId}
          organization={organization}
        />
        {/* credential is populated by WebAuthnButton before submit */}
        <input type="hidden" name="credential" defaultValue="" />

        <WebAuthnButton
          publicKey={publicKey}
          formRef={formRef}
          label={<Trans>Verify with security key</Trans>}
        />
      </RRForm>
    </AuthCeremony>
  );
}
