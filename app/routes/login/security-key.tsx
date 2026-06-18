import { AuthCard } from '@/components/auth-card/auth-card';
import { BackLink } from '@/components/back-link/back-link';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import {
  createWebAuthnVerifyHandlers,
  type WebAuthnVerifyActionData,
  type WebAuthnVerifyLoaderData,
} from '@/resources/webauthn/webauthn-verify';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
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

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

  return (
    <AuthCard
      title={<Trans>Verify with security key</Trans>}
      description={<Trans>Use your security key to verify your identity.</Trans>}>
      <div className="flex flex-col items-baseline justify-center gap-4">
        <IdentityBadge loginName={loginName} requestId={requestId} organization={organization} />

        {/* Hidden form that WebAuthnButton populates and submits. */}
        <RRForm ref={formRef} method="POST" className="flex w-full flex-col gap-4">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="loginName" value={loginName} />
          {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          {organization ? <input type="hidden" name="organization" value={organization} /> : null}
          {/* credential is populated by WebAuthnButton before submit */}
          <input type="hidden" name="credential" defaultValue="" />

          <WebAuthnButton
            publicKey={publicKey}
            formRef={formRef}
            label={<Trans>Verify with security key</Trans>}
          />
        </RRForm>

        <BackLink />
      </div>
    </AuthCard>
  );
}
