import {
  createWebAuthnVerifyHandlers,
  type WebAuthnVerifyActionData,
  type WebAuthnVerifyLoaderData,
} from './_shared/webauthn-verify';
import { AuthCard } from '@/components/auth-card';
import { WebAuthnButton } from '@/components/webauthn-button';
import { Trans } from '@lingui/react/macro';
import { useRef } from 'react';
import { useActionData, useLoaderData, type MetaFunction } from 'react-router';
import { Form as RRForm, Link } from 'react-router';

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

  // Extract the inner publicKey object that getAssertion expects.
  const publicKey =
    publicKeyCredentialRequestOptions !== null &&
    typeof publicKeyCredentialRequestOptions === 'object' &&
    'publicKey' in (publicKeyCredentialRequestOptions as object)
      ? (publicKeyCredentialRequestOptions as { publicKey: unknown }).publicKey
      : publicKeyCredentialRequestOptions;

  return (
    <AuthCard title={<Trans>Verify with security key</Trans>}>
      <div className="flex flex-col gap-4">
        <p className="text-foreground text-center text-sm">
          <Trans>Use your security key to verify your identity.</Trans>
        </p>

        {/* Hidden form that WebAuthnButton populates and submits. */}
        <RRForm ref={formRef} method="POST" className="flex flex-col gap-4">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="loginName" value={loginName} />
          {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          {organization ? <input type="hidden" name="organization" value={organization} /> : null}
          {/* credential is populated by WebAuthnButton before submit */}
          <input type="hidden" name="credential" defaultValue="" />

          {actionData?.error === 'INVALID_CREDENTIALS' ? (
            <p role="alert" className="text-sm text-red-700">
              <Trans>The security key verification failed. Please try again.</Trans>
            </p>
          ) : null}
          {actionData?.error === 'SESSION_EXPIRED' ? (
            <p role="alert" className="text-sm text-red-700">
              <Trans>Your session has expired.</Trans>{' '}
              <Link to="/login" className="underline">
                <Trans>Sign in again</Trans>
              </Link>
            </p>
          ) : null}
          <WebAuthnButton
            publicKey={publicKey}
            formRef={formRef}
            label={<Trans>Verify with security key</Trans>}
          />
        </RRForm>
      </div>
    </AuthCard>
  );
}
