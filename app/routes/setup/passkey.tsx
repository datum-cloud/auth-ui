import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { useAuthActionRecovery } from '@/hooks/use-auth-action-recovery';
import {
  createWebAuthnEnrollHandlers,
  PASSKEY_ENROLL_CONFIG,
  type WebAuthnEnrollActionData,
} from '@/resources/webauthn';
import { Trans } from '@lingui/react/macro';
import { useRef } from 'react';
import { useActionData, useLoaderData, type MetaFunction } from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Set up passkey' }];

// The loader/action are the shared enrollment factory (folded with
// setup/security-key). The route is a thin shell — only the user-facing JSX differs.
const h = createWebAuthnEnrollHandlers(PASSKEY_ENROLL_CONFIG);
export const loader = h.loader;
export const action = h.action;

export default function SetupPasskey() {
  // The local-const re-export lets RR7 infer the loader return (data<WebAuthnEnrollLoaderData>).
  const {
    csrfToken,
    loginName,
    requestId,
    organization,
    force,
    checkAfter,
    credentialId,
    publicKey,
    challengeFailed,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData() as WebAuthnEnrollActionData | undefined;
  const formRef = useRef<HTMLFormElement>(null);

  // Inline message + a recovery <Link> for recoverable codes (SESSION_EXPIRED → "Sign in again").
  const { message: errorMessage, recovery } = useAuthActionRecovery(actionData, {
    requestId,
    organization,
  });

  return (
    <AuthCeremony
      title={<Trans>Set up passkey</Trans>}
      description={
        <Trans>
          Register a passkey using your device's biometric sensor or PIN to sign in securely without
          a password.
        </Trans>
      }
      error={errorMessage}
      recovery={recovery}
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
        <input type="hidden" name="passkeyId" value={credentialId ?? ''} />
        {force ? <input type="hidden" name="force" value={force} /> : null}
        {checkAfter ? <input type="hidden" name="checkAfter" value={checkAfter} /> : null}
        {/* credential is populated by WebAuthnButton before submit */}
        <input type="hidden" name="credential" defaultValue="" />

        {/* The loader couldn't fetch an attestation challenge — warn up front
            with enrollment-specific copy (distinct from the assertion verification error). */}
        {challengeFailed ? (
          <FormError>
            <Trans>We couldn't start passkey setup. Please try again.</Trans>
          </FormError>
        ) : null}

        <WebAuthnButton
          publicKey={publicKey}
          formRef={formRef}
          mode="attestation"
          label={<Trans>Register passkey</Trans>}
        />
      </RRForm>
    </AuthCeremony>
  );
}
