import { AuthCard } from '@/components/auth-card/auth-card';
import { BackLink } from '@/components/back-link/back-link';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import {
  createWebAuthnVerifyHandlers,
  type WebAuthnVerifyActionData,
  type WebAuthnVerifyLoaderData,
} from '@/resources/webauthn/webauthn-verify';
import { Trans } from '@lingui/react/macro';
import { useRef } from 'react';
import { useActionData, useLoaderData, type MetaFunction } from 'react-router';
import { Form as RRForm, Link } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Verify with passkey' }];

// Passkey: userVerification REQUIRED (vs security key which uses DISCOURAGED).
// Individual named exports are required by the React Router Vite plugin — it
// cannot tree-shake a destructured const export from a factory call.
const _handlers = createWebAuthnVerifyHandlers({
  userVerificationRequirement: 'required',
  auditEvent: 'mfa_passkey',
  challengeAuditEvent: 'mfa_passkey_challenge',
});
export const loader = _handlers.loader;
export const action = _handlers.action;

export default function LoginPasskey() {
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

  return (
    <AuthCard title={<Trans>Verify with passkey</Trans>}>
      <div className="mb-4 flex flex-col items-center gap-2">
        <div className="self-start">
          <BackLink />
        </div>
        <IdentityBadge loginName={loginName} requestId={requestId} organization={organization} />
      </div>
      <div className="flex flex-col gap-4">
        <p className="text-foreground text-center text-sm">
          <Trans>Use your passkey to verify your identity.</Trans>
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
              <Trans>The passkey verification failed. Please try again.</Trans>
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
          <WebAuthnButton publicKey={publicKey} formRef={formRef} />
        </RRForm>
      </div>
    </AuthCard>
  );
}
