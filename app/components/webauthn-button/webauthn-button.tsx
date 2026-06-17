import {
  createAttestation,
  marshalAssertion,
  isWebAuthnSupported,
  WebAuthnUnsupportedError,
  type WebAuthnChallengeInput,
} from '@/resources/webauthn/webauthn';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { useNavigation, useSubmit } from 'react-router';

// Pre-baked credential for Cypress / test environments where navigator.credentials is unavailable.
// The fake provider's updateSession accepts any webAuthN payload so this value is arbitrary.
const CYPRESS_CREDENTIAL = {
  id: 'fake-credential-id',
  rawId: 'ZmFrZS1jcmVkZW50aWFsLWlk',
  type: 'public-key',
  response: {
    authenticatorData: 'ZmFrZS1hdXRoZW50aWNhdG9yLWRhdGE',
    clientDataJSON: 'ZmFrZS1jbGllbnQtZGF0YS1qc29u',
    signature: 'ZmFrZS1zaWduYXR1cmU',
    userHandle: null,
  },
};

interface WebAuthnButtonProps {
  /** The publicKey options from the loader challenge.
   *  - assertion mode (default): publicKeyCredentialRequestOptions.publicKey — may be null when
   *    the server-side challenge request failed (non-fatal — the button shows an error).
   *  - attestation mode: publicKeyCredentialCreationOptions.publicKey — passed by enrollment screens. */
  publicKey: unknown;
  /** Hidden form ref whose fields (csrf, loginName, …) ride along with the credential. */
  formRef: React.RefObject<HTMLFormElement | null>;
  /** Name of the hidden credential input in the form. */
  inputName?: string;
  /** Override loading state (e.g. when using a fetcher). */
  loading?: boolean;
  /** Button label — defaults to the passkey wording; security-key screens pass their own. */
  label?: React.ReactNode;
  /**
   * Ceremony mode.
   * - 'assertion' (default): drives navigator.credentials.get — used by login/passkey and
   *   login/security-key verify screens (existing behaviour, unchanged).
   * - 'attestation': drives navigator.credentials.create — used by setup/passkey and
   *   setup/security-key enrollment screens.
   */
  mode?: 'assertion' | 'attestation';
}

/**
 * Triggers a WebAuthn assertion ceremony on click, marshals the result into
 * the form's FormData, and submits it through React Router's useSubmit.
 *
 * Cypress / test path: when window.Cypress is detected (or WebAuthn is unsupported),
 * skips navigator.credentials and uses a pre-baked credential object instead.
 * The window.Cypress branch MUST come first — in Chrome under Cypress,
 * window.PublicKeyCredential exists, so isWebAuthnSupported() returns true and
 * the real navigator.credentials.get would hang (no authenticator present).
 *
 * Hydration gate: the SSR-rendered button is disabled until React mounts. Without
 * this, a click landing before hydration (Cypress clicks as soon as the button is
 * visible; slow connections hit it too) has no onClick handler attached and the
 * ceremony silently never starts. Cypress's actionability checks wait for the
 * disabled attribute to clear, which guarantees the click lands post-hydration.
 */
export function WebAuthnButton({
  publicKey,
  formRef,
  inputName = 'credential',
  loading,
  label,
  mode = 'assertion',
}: WebAuthnButtonProps) {
  const navigation = useNavigation();
  const submit = useSubmit();
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isSubmitting = loading ?? navigation.state !== 'idle';

  async function handleClick() {
    setError(null);
    try {
      let credential: Record<string, unknown>;

      const isCypress = typeof window !== 'undefined' && 'Cypress' in window;
      if (isCypress || !isWebAuthnSupported()) {
        // Cypress fake-credential path: no publicKey needed.
        // The pre-baked credential works for both assertion and attestation because
        // the fake provider accepts any payload for both verifyPasskey and verifyU2F.
        credential = CYPRESS_CREDENTIAL;
      } else {
        // Guard: if the server-side challenge failed (loader caught an error and left
        // the options null), we have no options to pass to the authenticator — surface
        // the failure instead of calling the WebAuthn API with null.
        if (!publicKey) {
          setError('webauthn-failed');
          return;
        }
        if (mode === 'attestation') {
          // Enrollment ceremony: navigator.credentials.create
          credential = await createAttestation(publicKey as WebAuthnChallengeInput);
        } else {
          // Verification ceremony (default): navigator.credentials.get
          credential = await marshalAssertion(publicKey as WebAuthnChallengeInput);
        }
      }

      const form = formRef.current;
      if (!form) {
        setError('webauthn-failed');
        return;
      }

      // Build FormData from the hidden fields (csrf, loginName, …) and inject the credential.
      const formData = new FormData(form);
      formData.set(inputName, JSON.stringify(credential));
      void submit(formData, { method: 'post' });
    } catch (err) {
      if (err instanceof WebAuthnUnsupportedError) {
        setError('webauthn-unsupported');
      } else {
        setError('webauthn-failed');
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error === 'webauthn-unsupported' ? (
        <p role="alert" className="text-sm text-red-700">
          <Trans>Your browser does not support passkeys. Please use a supported browser.</Trans>
        </p>
      ) : error === 'webauthn-failed' ? (
        <p role="alert" className="text-sm text-red-700">
          {mode === 'attestation' ? (
            // CODE-MIN-30: enrollment (attestation) failure — distinct from verification.
            <Trans>We couldn't set up your passkey. Please try again.</Trans>
          ) : (
            <Trans>The passkey verification failed. Please try again.</Trans>
          )}
        </p>
      ) : null}
      <Button
        type="primary"
        theme="solid"
        block
        htmlType="button"
        disabled={!mounted}
        loading={isSubmitting}
        onClick={() => {
          void handleClick();
        }}>
        {label ?? <Trans>Verify with passkey</Trans>}
      </Button>
    </div>
  );
}
