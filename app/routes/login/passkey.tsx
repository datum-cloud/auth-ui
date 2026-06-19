import { AuthCard } from '@/components/auth-card/auth-card';
import { BackLink } from '@/components/back-link/back-link';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import { serializeLastUsedLogin } from '@/modules/auth/session/last-used-login';
import {
  createWebAuthnVerifyHandlers,
  type WebAuthnVerifyActionData,
  type WebAuthnVerifyLoaderData,
} from '@/resources/webauthn/webauthn-verify';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
import { Trans } from '@lingui/react/macro';
import { useRef } from 'react';
import { useActionData, useLoaderData, type MetaFunction, type ActionFunctionArgs } from 'react-router';
import { Form as RRForm } from 'react-router';

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

// Wrap the factory action to append the last-used-login cookie on successful
// passkey sign-in. Two Set-Cookie headers cannot be joined into one string, so
// we clone the redirect response and append via Headers.append().
export async function action(args: ActionFunctionArgs) {
  const result = await _handlers.action(args);
  // Only decorate successful redirects (3xx with a Location header).
  if (!(result instanceof Response) || !result.headers.get('location')) {
    return result;
  }
  const headers = new Headers(result.headers);
  headers.append('set-cookie', await serializeLastUsedLogin('passkey'));
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}

export default function LoginPasskey() {
  // React Router 7 cannot infer `typeof loader` through the factory return value,
  // so we use the exported concrete type instead of `useLoaderData<typeof loader>()`.
  const { csrfToken, loginName, requestId, organization, publicKeyCredentialRequestOptions } =
    useLoaderData() as WebAuthnVerifyLoaderData;
  // React Router 7 cannot infer `typeof action` through a factory return — resolves to `never`.
  // Use the exported concrete type instead.
  const actionData = useActionData() as WebAuthnVerifyActionData | undefined;
  const formRef = useRef<HTMLFormElement>(null);

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

  // Extract the inner publicKey object that marshalAssertion expects.
  const publicKey =
    publicKeyCredentialRequestOptions !== null &&
    typeof publicKeyCredentialRequestOptions === 'object' &&
    'publicKey' in (publicKeyCredentialRequestOptions as object)
      ? (publicKeyCredentialRequestOptions as { publicKey: unknown }).publicKey
      : publicKeyCredentialRequestOptions;

  return (
    <AuthCard
      title={<Trans>Verify with passkey</Trans>}
      description={<Trans>Use your passkey to verify your identity.</Trans>}>
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

          <WebAuthnButton publicKey={publicKey} formRef={formRef} />
        </RRForm>

        <BackLink />
      </div>
    </AuthCard>
  );
}
