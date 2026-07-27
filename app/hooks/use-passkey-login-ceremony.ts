import { CYPRESS_CREDENTIAL } from '@/components/webauthn-button/webauthn-button';
import {
  marshalAssertion,
  isWebAuthnSupported,
  WebAuthnCeremonyError,
  WebAuthnUnsupportedError,
  type WebAuthnChallengeInput,
  type WebAuthnReason,
} from '@/resources/webauthn/webauthn';
import type { WebAuthnVerifyLoaderData } from '@/resources/webauthn/webauthn-verify';
import { paths } from '@/routes/paths';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';

export type PasskeyCeremonyPhase = 'idle' | 'loading-challenge' | 'ceremony' | 'submitting';

export interface PasskeyLoginCeremonyInput {
  loginName: string;
  requestId?: string;
  organization?: string;
}

/** Extract the inner publicKey the marshaller expects (mirrors login/passkey.tsx). */
function unwrapPublicKey(options: unknown): unknown {
  return options !== null && typeof options === 'object' && 'publicKey' in (options as object)
    ? (options as { publicKey: unknown }).publicKey
    : options;
}

/**
 * Drives a passkey SIGN-IN from any surface without navigating: challenge from
 * the /login/passkey LOADER (lazy via fetcher.load, or pre-minted by a caller),
 * WebAuthn assertion (Cypress pre-baked path included), credential submit to
 * the /login/passkey ACTION — whose success redirect the fetcher follows
 * (lastUsed cookie + reauth identity guard come along for free).
 */
export function usePasskeyLoginCeremony(input: PasskeyLoginCeremonyInput) {
  const challengeFetcher = useFetcher<WebAuthnVerifyLoaderData>();
  const submitFetcher = useFetcher();
  const [phase, setPhase] = useState<PasskeyCeremonyPhase>('idle');
  const [reason, setReason] = useState<WebAuthnReason | null>(null);
  // One ceremony per acquired challenge — survives re-renders, resets on begin().
  const consumedChallenge = useRef<unknown>(null);

  const passkeyPath = paths.login.passkey({
    loginName: input.loginName,
    requestId: input.requestId,
    organization: input.organization,
  });

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
            credential: JSON.stringify(credential),
            loginName: input.loginName,
            ...(input.requestId ? { requestId: input.requestId } : {}),
            ...(input.organization ? { organization: input.organization } : {}),
            // Marker read by /login/passkey's shouldRevalidate: this in-place ceremony
            // submits the assertion to the SAME route its challenge was loaded from, so
            // RR's default post-submit revalidation would re-run the loader and rotate
            // the Zitadel challenge out from under the just-signed assertion (WEBAU-3M9si).
            // The verify schema ignores this extra field.
            passkeyCeremony: '1',
          },
          { method: 'post', action: passkeyPath }
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
    [input.loginName, input.requestId, input.organization, passkeyPath, submitFetcher]
  );

  /** Lazy path: fetch a fresh challenge from the /login/passkey loader, then run. */
  const begin = useCallback(() => {
    setReason(null);
    consumedChallenge.current = null;
    setPhase('loading-challenge');
    challengeFetcher.load(passkeyPath);
  }, [challengeFetcher, passkeyPath]);

  /** Pre-minted path (sole-passkey inline): run immediately with caller-supplied data. */
  const beginWith = useCallback(
    (preMinted: { csrfToken: string; publicKeyCredentialRequestOptions: unknown }) => {
      setReason(null);
      void runCeremony(preMinted.csrfToken, preMinted.publicKeyCredentialRequestOptions);
    },
    [runCeremony]
  );

  // Lazy path completion: when the loader data lands, run the ceremony once.
  useEffect(() => {
    if (phase !== 'loading-challenge' || challengeFetcher.state !== 'idle') return;
    const d = challengeFetcher.data;
    if (!d) return;
    void runCeremony(d.csrfToken, d.publicKeyCredentialRequestOptions);
  }, [phase, challengeFetcher.state, challengeFetcher.data, runCeremony]);

  // Action rejection (e.g. INVALID_CREDENTIALS on challenge expiry) returns data,
  // not a redirect — drop back to idle so the surface can offer retry.
  useEffect(() => {
    if (phase === 'submitting' && submitFetcher.state === 'idle' && submitFetcher.data) {
      setPhase('idle');
    }
  }, [phase, submitFetcher.state, submitFetcher.data]);

  return { begin, beginWith, phase, reason, actionData: submitFetcher.data as unknown };
}
