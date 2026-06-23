import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { useAuthActionRecovery } from '@/hooks/use-auth-action-recovery';
import {
  createWebAuthnEnrollHandlers,
  U2F_ENROLL_CONFIG,
  type WebAuthnEnrollActionData,
} from '@/resources/webauthn';
import { Trans } from '@lingui/react/macro';
import { useRef } from 'react';
import { useActionData, useLoaderData, type MetaFunction } from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Set up security key' }];

// The loader/action are the shared enrollment factory (folded with
// setup/passkey). The route is a thin shell — only the user-facing JSX differs.
const h = createWebAuthnEnrollHandlers(U2F_ENROLL_CONFIG);
export const loader = h.loader;
export const action = h.action;

export default function SetupSecurityKey() {
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
  } = useLoaderData<typeof loader>();
  const actionData = useActionData() as WebAuthnEnrollActionData | undefined;
  const formRef = useRef<HTMLFormElement>(null);

  // Inline message + a recovery <Link> for recoverable codes (SESSION_EXPIRED → "Sign in again").
  const { message: errorMessage, recovery } = useAuthActionRecovery(actionData);

  return (
    <AuthCeremony
      title={<Trans>Set up security key</Trans>}
      description={
        <Trans>
          Register a hardware security key (e.g. YubiKey) as a second factor for your account.
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
        <input type="hidden" name="u2fId" value={credentialId ?? ''} />
        {force ? <input type="hidden" name="force" value={force} /> : null}
        {checkAfter ? <input type="hidden" name="checkAfter" value={checkAfter} /> : null}
        {/* credential is populated by WebAuthnButton before submit */}
        <input type="hidden" name="credential" defaultValue="" />

        <WebAuthnButton
          publicKey={publicKey}
          formRef={formRef}
          mode="attestation"
          label={<Trans>Set up security key</Trans>}
        />
      </RRForm>
    </AuthCeremony>
  );
}
