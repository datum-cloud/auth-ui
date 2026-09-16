// app/components/recovery-ceremony/recovery-ceremony.tsx
//
// The name-after-ceremony step, shared by both recovery doors: the typed-code path renders it
// inside /recover, the mailed-link path inside /recover/complete. One component because the two
// doors converge on ONE ceremony (recovery-ceremony.ts) and a second copy of this form is how
// they would start disagreeing about what gets posted.
//
// Mirrors /setup/passkey's held-credential UX: run the WebAuthn ceremony first, hold the result
// in memory, then ask for a name and post both together. Note what is NOT here — no loginName, no
// userId. Identity comes from the sealed ceremony ticket the server set; the posted `passkeyId`
// is only ever CHECKED against it (see finishRecoveryCeremony).
import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { FormError } from '@/components/form-error/form-error';
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { aaguidFromAttestationObject, defaultPasskeyName } from '@/resources/webauthn/aaguid';
import { paths } from '@/routes/paths';
import { Button } from '@datum-cloud/datum-ui/button';
import { Input } from '@datum-cloud/datum-ui/input';
import { Label } from '@datum-cloud/datum-ui/label';
import { Trans } from '@lingui/react/macro';
import { useRef, useState } from 'react';
import { Link, Form as RRForm, useNavigation } from 'react-router';

/** The credential held between the ceremony (step 1) and the name step (step 2). */
interface HeldCredential {
  credential: Record<string, unknown>;
  /** AAGUID catalog name, else the UA-derived fallback — the name input's pre-fill. */
  defaultName: string;
  /** UA-derived device label — rendered as a hint when it adds context over defaultName. */
  uaName: string;
}

export interface RecoveryCeremonyFormProps {
  csrfToken: string;
  publicKey: unknown;
  passkeyId: string;
  requestId?: string;
  organization?: string;
  /** RECOVERY_EXPIRED replaces the whole form with the "request a new link" card. */
  error?: string;
}

export function RecoveryCeremonyForm({
  csrfToken,
  publicKey,
  passkeyId,
  requestId,
  organization,
  error,
}: RecoveryCeremonyFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const navigation = useNavigation();
  const [held, setHeld] = useState<HeldCredential | null>(null);

  // A consumed or expired code is terminal: the code is single-use in Zitadel, so there is
  // nothing to retry on this screen. Send the user back to ask for a new one.
  if (error === 'RECOVERY_EXPIRED') {
    return (
      <AuthCeremony
        title={<Trans>This link is invalid or has expired</Trans>}
        description={
          <Trans>
            Recovery links can only be used once, and they expire. Request a new one to continue.
          </Trans>
        }>
        <Link to={paths.recover.index({ requestId, organization })} className="w-full">
          <Button type="primary" theme="solid" block>
            <Trans>Request a new link</Trans>
          </Button>
        </Link>
      </AuthCeremony>
    );
  }

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
      title={held ? <Trans>Name your passkey</Trans> : <Trans>Set up a new passkey</Trans>}
      description={
        held ? (
          <Trans>Your passkey is ready — give it a name so you can recognize it later.</Trans>
        ) : (
          <Trans>
            Register a passkey using your device's biometric sensor or PIN. You'll use it to sign in
            from now on.
          </Trans>
        )
      }>
      {error && error !== 'RECOVERY_EXPIRED' ? (
        <FormError>
          <Trans>We couldn't finish setting up your passkey. Please try again.</Trans>
        </FormError>
      ) : null}

      {/* One form spans both steps — the hidden fields ride along on the step-2 submit. */}
      <RRForm ref={formRef} method="POST" className="flex w-full flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="intent" value="verify" />
        {/* CHECKED against the sealed ticket server-side, never trusted as the value. */}
        <input type="hidden" name="passkeyId" value={passkeyId} />
        {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
        {organization ? <input type="hidden" name="organization" value={organization} /> : null}
        <input
          type="hidden"
          name="credential"
          value={held ? JSON.stringify(held.credential) : ''}
          readOnly
        />

        {held ? (
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
            <Button
              type="primary"
              theme="solid"
              htmlType="submit"
              block
              loading={navigation.state !== 'idle'}>
              <Trans>Save</Trans>
            </Button>
          </div>
        ) : (
          <WebAuthnButton
            publicKey={publicKey}
            formRef={formRef}
            mode="attestation"
            label={<Trans>Register passkey</Trans>}
            onCredential={handleCredential}
          />
        )}
      </RRForm>
    </AuthCeremony>
  );
}
