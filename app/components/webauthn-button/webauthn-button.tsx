import { FormError } from '../form-error/form-error';
import {
  createAttestation,
  marshalAssertion,
  isWebAuthnSupported,
  WebAuthnCeremonyError,
  WebAuthnUnsupportedError,
  type WebAuthnChallengeInput,
  type WebAuthnReason,
} from '@/resources/webauthn/webauthn';
import { Button } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans } from '@lingui/react/macro';
import { UserKey } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigation, useSubmit } from 'react-router';

// Pre-baked credential for Cypress / test environments where navigator.credentials is unavailable.
// The fake provider's updateSession accepts any webAuthN payload so this value is arbitrary.
export const CYPRESS_CREDENTIAL = {
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

/**
 * Rendered failure state.
 * - 'browser-unsupported': the browser lacks WebAuthn entirely (pre-ceremony support check /
 *   WebAuthnUnsupportedError) — a single shared message.
 * - 'ceremony': the create/get ceremony failed; `reason` (from classifyWebAuthnError) plus the
 *   flow (enroll vs sign-in) selects the specific copy.
 */
type WebAuthnErrorState =
  { kind: 'browser-unsupported' } | { kind: 'ceremony'; reason: WebAuthnReason } | null;

/**
 * Reason → user copy for a SIGN-IN (assertion) ceremony failure. Every branch is a literal
 * <Trans> so Lingui extraction picks it up statically. Moved verbatim out of the button so
 * surfaces that run the login ceremony without this button (usePasskeyLoginCeremony) can render
 * the identical messages. `already-registered` has no sign-in meaning, so it falls back to the
 * generic copy via the default branch.
 */
export function WebAuthnReasonCopy({ reason }: { reason: WebAuthnReason }) {
  switch (reason) {
    case 'not-allowed':
      return (
        <Trans>
          Passkey sign-in was cancelled, or no passkey for this account is available on this device.
          Make sure you're using a device where you set up your passkey, then try again.
        </Trans>
      );
    case 'unsupported':
      return (
        <Trans>
          This device can't use a passkey to sign in. Try another device or a different sign-in
          method.
        </Trans>
      );
    case 'security':
      return (
        <Trans>
          Passkey sign-in couldn't be completed for security reasons. Please contact support if this
          continues.
        </Trans>
      );
    default:
      return <Trans>The passkey verification failed. Please try again.</Trans>;
  }
}

/**
 * Reason- AND flow-specific ceremony failure copy. enroll = attestation (create), sign-in =
 * assertion (get). The sign-in branch delegates to the exported WebAuthnReasonCopy so both
 * copies stay byte-identical wherever they're rendered.
 */
function ceremonyMessage(
  reason: WebAuthnReason,
  mode: 'assertion' | 'attestation'
): React.ReactNode {
  if (mode === 'attestation') {
    switch (reason) {
      case 'not-allowed':
        return (
          <Trans>
            Passkey setup was cancelled, or this device has no passkey support. Make sure Touch ID,
            Windows Hello, a security key, or a password manager is available, then try again.
          </Trans>
        );
      case 'already-registered':
        return <Trans>You already have a passkey for this account on this device.</Trans>;
      case 'unsupported':
        return (
          <Trans>
            This device can't create a passkey. Try another device, a security key, or a password
            manager.
          </Trans>
        );
      case 'security':
        return (
          <Trans>
            Passkey setup couldn't be completed for security reasons. Please contact support if this
            continues.
          </Trans>
        );
      default:
        return <Trans>We couldn't set up your passkey. Please try again.</Trans>;
    }
  }
  return <WebAuthnReasonCopy reason={reason} />;
}

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
  /**
   * When set, the finished ceremony credential is handed to the parent
   * INSTEAD of auto-submitting the form — the two-step enroll flow (ceremony → name
   * step → submit) holds it in route state between steps. Runs on the Cypress
   * pre-baked path too, so tests exercise the same handoff.
   */
  onCredential?: (credential: Record<string, unknown>) => void;
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
  onCredential,
}: WebAuthnButtonProps) {
  const navigation = useNavigation();
  const submit = useSubmit();
  const [error, setError] = useState<WebAuthnErrorState>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  // 'submitting' means THIS form's own action is in flight. 'loading' also covers an
  // unrelated navigation elsewhere on the page (e.g. clicking the BackLink or an
  // identity "Not you?" link) — using navigation.state !== 'idle' here made this
  // button flash busy/disabled for a click it had nothing to do with.
  const isSubmitting = loading ?? navigation.state === 'submitting';

  async function handleClick() {
    setError(null);
    try {
      let credential: Record<string, unknown>;

      const isCypress = typeof window !== 'undefined' && 'Cypress' in window;
      if (!isCypress && !isWebAuthnSupported()) {
        // Real browser without WebAuthn — surface the unsupported message immediately
        // instead of submitting the fake Cypress credential to the production backend.
        setError({ kind: 'browser-unsupported' });
        return;
      }
      // Cypress fake-credential path: no publicKey needed. The pre-baked credential works for
      // both assertion and attestation because the fake provider accepts any payload. A spec may
      // opt OUT of the fake (window.__webAuthnRealCeremony) to drive the REAL ceremony against a
      // stubbed navigator.credentials and assert reason-specific failure copy; undefined in prod.
      const useFakeCredential =
        isCypress &&
        !(window as unknown as { __webAuthnRealCeremony?: boolean }).__webAuthnRealCeremony;
      if (useFakeCredential) {
        credential = CYPRESS_CREDENTIAL;
      } else {
        // Guard: if the server-side challenge failed (loader caught an error and left
        // the options null), we have no options to pass to the authenticator — surface
        // the failure instead of calling the WebAuthn API with null.
        if (!publicKey) {
          setError({ kind: 'ceremony', reason: 'unknown' });
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

      // Two-step enroll: hand the credential up instead of submitting.
      if (onCredential) {
        onCredential(credential);
        return;
      }

      const form = formRef.current;
      if (!form) {
        setError({ kind: 'ceremony', reason: 'unknown' });
        return;
      }

      // Build FormData from the hidden fields (csrf, loginName, …) and inject the credential.
      const formData = new FormData(form);
      formData.set(inputName, JSON.stringify(credential));
      void submit(formData, { method: 'post' });
    } catch (err) {
      if (err instanceof WebAuthnUnsupportedError) {
        setError({ kind: 'browser-unsupported' });
      } else if (err instanceof WebAuthnCeremonyError) {
        // Reason-classified ceremony failure (thrown DOMException / null credential).
        setError({ kind: 'ceremony', reason: err.reason });
      } else {
        setError({ kind: 'ceremony', reason: 'unknown' });
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error?.kind === 'browser-unsupported' ? (
        <FormError>
          <Trans>Your browser does not support passkeys. Please use a supported browser.</Trans>
        </FormError>
      ) : error?.kind === 'ceremony' ? (
        // Reason- AND flow-specific copy (enroll vs sign-in). See ceremonyMessage.
        <FormError>{ceremonyMessage(error.reason, mode)}</FormError>
      ) : null}
      <Button
        size="large"
        className="h-13 gap-3"
        type="quaternary"
        theme="outline"
        block
        iconPosition="left"
        icon={<Icon icon={UserKey} />}
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
