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
import { aaguidFromAttestationObject, defaultPasskeyName } from '@/resources/webauthn/aaguid';
import { Button } from '@datum-cloud/datum-ui/button';
import { Input } from '@datum-cloud/datum-ui/input';
import { Label } from '@datum-cloud/datum-ui/label';
import { Trans } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';
import { useActionData, useLoaderData, useNavigation, type MetaFunction } from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Set up passkey' }];

// The loader/action are the shared enrollment factory (folded with
// setup/security-key). The route is a thin shell — only the user-facing JSX differs.
const h = createWebAuthnEnrollHandlers(PASSKEY_ENROLL_CONFIG);
export const loader = h.loader;
export const action = h.action;

/** The credential held between the ceremony (step 1) and the name step (step 2). */
interface HeldCredential {
  credential: Record<string, unknown>;
  /** AAGUID catalog name, else the UA-derived fallback — the name input's pre-fill. */
  defaultName: string;
  /** UA-derived device label — rendered as a hint when it adds context over defaultName. */
  uaName: string;
}

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
    returnTo,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData() as WebAuthnEnrollActionData | undefined;
  const formRef = useRef<HTMLFormElement>(null);
  const navigation = useNavigation();

  // Name-after-ceremony: null = step 1 (run the ceremony), non-null = step 2
  // (name the held credential). The AAGUID exists only in the returned attestation,
  // so the pre-fill is computed at this transition.
  const [held, setHeld] = useState<HeldCredential | null>(null);

  // Inline message + a recovery <Link> for recoverable codes (SESSION_EXPIRED → "Sign in again").
  const { message: errorMessage, recovery } = useAuthActionRecovery(actionData, {
    requestId,
    organization,
  });

  // A verify failure while holding a credential (challenge expiry surfaces as
  // INVALID_CREDENTIALS) auto-resets to step 1 — React Router's post-action
  // revalidation has already fetched a fresh challenge, so one click retries the
  // full ceremony.
  useEffect(() => {
    if (actionData?.error) setHeld(null);
  }, [actionData]);

  function handleCredential(credential: Record<string, unknown>) {
    const att = (credential.response as { attestationObject?: string } | undefined)
      ?.attestationObject;
    const aaguid = att ? aaguidFromAttestationObject(att) : null;
    setHeld({
      credential,
      defaultName: defaultPasskeyName(aaguid, navigator.userAgent),
      uaName: defaultPasskeyName(null, navigator.userAgent),
    });
  }

  return (
    <AuthCeremony
      title={held ? <Trans>Name your passkey</Trans> : <Trans>Set up passkey</Trans>}
      description={
        held ? (
          <Trans>Your passkey is ready — give it a name so you can recognize it later.</Trans>
        ) : (
          <Trans>
            Register a passkey using your device's biometric sensor or PIN to sign in securely
            without a password.
          </Trans>
        )
      }
      /* A prior failure's banner is step-1 context — a freshly re-entered
         name step must not show "setup failed" beside "your passkey is ready". */
      error={held ? undefined : errorMessage}
      recovery={held ? undefined : recovery}
      loginName={loginName}
      requestId={requestId}
      organization={organization}>
      {/* One form spans both steps — the hidden fields ride along on the step-2 submit. */}
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
        {/* Validated return target (/passkeys round-trip) — posted, re-validated server-side. */}
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        {/* Carries the held ceremony result into the step-2 submit. */}
        <input
          type="hidden"
          name="credential"
          value={held ? JSON.stringify(held.credential) : ''}
          readOnly
        />

        {held ? (
          <>
            {/* Step 2 — Save-only: the authenticator-side credential already exists,
                so there is no cancel (it would orphan the entry in the user's password
                manager). Pre-fill from AAGUID, else the UA fallback; set-once (no rename RPC). */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="passkeyName">
                <Trans>Passkey name</Trans>
              </Label>
              <Input
                id="passkeyName"
                name="passkeyName"
                maxLength={200}
                defaultValue={held.defaultName}
                autoFocus
              />
              {held.uaName !== held.defaultName ? (
                <p className="text-foreground/60 text-xs">
                  <Trans>Created using {held.uaName}</Trans>
                </p>
              ) : null}
              <p className="text-foreground/60 text-xs">
                <Trans>
                  This name is for your Datum passkey list — your password manager labels it
                  separately. Names can't be changed later.
                </Trans>
              </p>
            </div>
            <Button
              type="primary"
              theme="solid"
              htmlType="submit"
              block
              loading={navigation.state !== 'idle'}>
              <Trans>Save</Trans>
            </Button>
          </>
        ) : (
          <>
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
              onCredential={handleCredential}
            />
          </>
        )}
      </RRForm>
    </AuthCeremony>
  );
}
