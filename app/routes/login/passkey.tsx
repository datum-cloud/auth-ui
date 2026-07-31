import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { serializeLastUsedLogin } from '@/modules/auth/session/last-used-login';
import { serializePasskeyHint } from '@/modules/auth/session/passkey-hint';
import {
  createWebAuthnVerifyHandlers,
  type WebAuthnVerifyActionData,
  type WebAuthnVerifyLoaderData,
} from '@/resources/webauthn/webauthn-verify';
import { Trans } from '@lingui/react/macro';
import { useRef } from 'react';
import {
  useActionData,
  useLoaderData,
  type MetaFunction,
  type ActionFunctionArgs,
} from 'react-router';
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

// The in-place login ceremony (usePasskeyLoginCeremony) loads this route's loader
// for a challenge via fetcher, then submits the assertion to this route's action.
// RR's default post-submit revalidation would re-run the loader and mint a FRESH
// challenge on the Zitadel session, invalidating the just-signed assertion mid-flight
// (WEBAU-3M9si). Suppress ONLY that self-triggered revalidation — the hook tags its
// submit with `passkeyCeremony`. A full-page visit or retry (no marker) revalidates
// normally, so it always renders a fresh challenge.
export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: {
  formData?: FormData;
  defaultShouldRevalidate: boolean;
}) {
  if (formData?.get('passkeyCeremony') === '1') return false;
  return defaultShouldRevalidate;
}

// Wrap the factory action to append the last-used-login + passkey-hint cookies on
// successful passkey sign-in. Two Set-Cookie headers cannot be joined into one string,
// so we clone the redirect response and append via Headers.append(). loginName is read
// from a CLONE of the request BEFORE the factory action consumes the body.
export async function action(args: ActionFunctionArgs) {
  const form = await args.request.clone().formData();
  const loginName = String(form.get('loginName') ?? '');
  const result = await _handlers.action(args);
  // Only decorate successful redirects (3xx with a Location header).
  if (!(result instanceof Response) || !result.headers.get('location')) {
    return result;
  }
  const headers = new Headers(result.headers);
  headers.append('set-cookie', await serializeLastUsedLogin('passkey'));
  if (loginName) headers.append('set-cookie', await serializePasskeyHint(loginName));
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

  // Shared error pipeline; the message now surfaces inline through AuthCeremony.
  const errorMessage = useAuthActionError(actionData);

  // Extract the inner publicKey object that marshalAssertion expects.
  const publicKey =
    publicKeyCredentialRequestOptions !== null &&
    typeof publicKeyCredentialRequestOptions === 'object' &&
    'publicKey' in (publicKeyCredentialRequestOptions as object)
      ? (publicKeyCredentialRequestOptions as { publicKey: unknown }).publicKey
      : publicKeyCredentialRequestOptions;

  return (
    <AuthCeremony
      title={<Trans>Verify with passkey</Trans>}
      description={<Trans>Use your passkey to verify your identity.</Trans>}
      error={errorMessage}
      loginName={loginName}
      requestId={requestId}
      organization={organization}
      showBackLink={true}>
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

        {/* Generic label — at sign-in the credential may live in a
            password manager, security key, or another device, so platform branding misleads. */}
        <WebAuthnButton
          publicKey={publicKey}
          formRef={formRef}
          label={<Trans>Sign in with your passkey</Trans>}
        />
      </RRForm>
    </AuthCeremony>
  );
}
