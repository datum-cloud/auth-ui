import { CYPRESS_CREDENTIAL } from '@/components/webauthn-button/webauthn-button';
import {
  marshalAssertion,
  isWebAuthnSupported,
  WebAuthnCeremonyError,
  WebAuthnUnsupportedError,
  type WebAuthnChallengeInput,
  type WebAuthnReason,
} from '@/resources/webauthn/webauthn';
import { paths } from '@/routes/paths';
import type { ReauthLoaderData } from '@/routes/reauth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';

export type PasskeyReauthCeremonyPhase = 'idle' | 'loading-challenge' | 'ceremony' | 'submitting';

export interface PasskeyReauthCeremonyInput {
  returnTo: string;
}

/** Extract the inner publicKey the marshaller expects (mirrors use-passkey-login-ceremony). */
function unwrapPublicKey(options: unknown): unknown {
  return options !== null && typeof options === 'object' && 'publicKey' in (options as object)
    ? (options as { publicKey: unknown }).publicKey
    : options;
}

/**
 * Drives a passkey RE-AUTH from the /reauth chooser without navigating: challenge
 * from THIS route's own loader (lazy via fetcher.load, ?method=passkey), WebAuthn
 * assertion (Cypress pre-baked path included), credential submit to THIS route's
 * action — whose success redirect the fetcher follows. Mirrors
 * usePasskeyLoginCeremony's lazy path; reauth has no pre-minted path since it's
 * only ever reached from the multi-method chooser, never a sole-factor shortcut.
 */
export function usePasskeyReauthCeremony(input: PasskeyReauthCeremonyInput) {
  const challengeFetcher = useFetcher<ReauthLoaderData>();
  const submitFetcher = useFetcher();
  const [phase, setPhase] = useState<PasskeyReauthCeremonyPhase>('idle');
  const [reason, setReason] = useState<WebAuthnReason | null>(null);
  // One ceremony per acquired challenge — survives re-renders, resets on begin().
  const consumedChallenge = useRef<unknown>(null);

  const challengePath = paths.reauth({ method: 'passkey', returnTo: input.returnTo });

  const runCeremony = useCallback(
    async (csrfToken: string, publicKeyCredentialRequestOptions: unknown) => {
      if (consumedChallenge.current === publicKeyCredentialRequestOptions) return;
      consumedChallenge.current = publicKeyCredentialRequestOptions;
      setPhase('ceremony');
      try {
        let credential: Record<string, unknown>;
        // Cypress fake-credential path — same gate as WebAuthnButton so component
        // specs exercise the identical handoff.
        const useFake =
          typeof window !== 'undefined' &&
          (window as unknown as { Cypress?: unknown }).Cypress !== undefined &&
          !(window as unknown as { __webAuthnRealCeremony?: boolean }).__webAuthnRealCeremony;
        if (useFake) {
          credential = CYPRESS_CREDENTIAL;
        } else {
          if (!isWebAuthnSupported()) throw new WebAuthnUnsupportedError();
          credential = await marshalAssertion(
            unwrapPublicKey(publicKeyCredentialRequestOptions) as WebAuthnChallengeInput
          );
        }
        setPhase('submitting');
        submitFetcher.submit(
          {
            csrf: csrfToken,
            factor: 'passkey',
            credential: JSON.stringify(credential),
            returnTo: input.returnTo,
            // Marker read by reauth.tsx's shouldRevalidate: this in-place ceremony submits
            // to the SAME route its challenge was loaded from, so RR's default post-submit
            // revalidation would re-run the loader and rotate the Zitadel challenge out from
            // under the just-signed assertion (same class of bug as WEBAU-3M9si in
            // login/passkey.tsx). The action schema ignores this extra field.
            passkeyCeremony: '1',
          },
          { method: 'post', action: paths.reauth() }
        );
      } catch (err) {
        setPhase('idle');
        // WebAuthnCeremonyError carries a classified reason; WebAuthnUnsupportedError has none
        // (it has no `.reason` field) — its closest existing WebAuthnReason is 'unsupported'.
        setReason(
          err instanceof WebAuthnCeremonyError
            ? err.reason
            : err instanceof WebAuthnUnsupportedError
              ? 'unsupported'
              : 'unknown'
        );
      }
    },
    [input.returnTo, submitFetcher]
  );

  /** Fetch a fresh challenge from this route's own loader, then run. */
  const begin = useCallback(() => {
    setReason(null);
    consumedChallenge.current = null;
    setPhase('loading-challenge');
    challengeFetcher.load(challengePath);
  }, [challengeFetcher, challengePath]);

  // Challenge-load completion: when the loader data lands, run the ceremony once.
  useEffect(() => {
    if (phase !== 'loading-challenge' || challengeFetcher.state !== 'idle') return;
    const d = challengeFetcher.data;
    if (!d) return;
    void runCeremony(d.csrfToken, d.view.publicKeyCredentialRequestOptions);
  }, [phase, challengeFetcher.state, challengeFetcher.data, runCeremony]);

  // Action rejection (e.g. INVALID_CREDENTIALS on challenge expiry) returns data,
  // not a redirect — drop back to idle so the chooser can offer retry.
  useEffect(() => {
    if (phase === 'submitting' && submitFetcher.state === 'idle' && submitFetcher.data) {
      setPhase('idle');
    }
  }, [phase, submitFetcher.state, submitFetcher.data]);

  return { begin, phase, reason, actionData: submitFetcher.data as unknown };
}
