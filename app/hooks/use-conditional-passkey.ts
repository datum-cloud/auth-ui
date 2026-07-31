import { CYPRESS_CREDENTIAL } from '@/components/webauthn-button/webauthn-button';
import { unwrapPublicKey } from '@/hooks/use-passkey-login-ceremony';
import { APP_BASENAME } from '@/resources/shared/app-basename';
import {
  marshalAssertion,
  isWebAuthnSupported,
  WebAuthnCeremonyError,
  type WebAuthnChallengeInput,
  type WebAuthnReason,
} from '@/resources/webauthn/webauthn';
import type { WebAuthnVerifyLoaderData } from '@/resources/webauthn/webauthn-verify';
import { paths } from '@/routes/paths';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';

export type ConditionalPasskeyPhase = 'idle' | 'armed' | 'submitting' | 'done';

/** The discover action's success payload (declared locally — importing the route
 *  module would drag its server-only imports into the client graph). */
interface DiscoverResponse {
  loginName: string;
  csrfToken: string;
  publicKeyCredentialRequestOptions: unknown;
}

export interface ConditionalPasskeyInput {
  /** Master switch — false keeps the hook fully inert (no detection, no arming). */
  enabled: boolean;
  /** 'hinted' (default): the loader pre-minted a user-bound Zitadel challenge; the
   *  assertion submits straight to the verify action. 'discovery': the loader minted
   *  a SELF-issued identity challenge; the first assertion is an identity claim that
   *  posts to /login/passkey-discover, whose response carries the real challenge for
   *  a modal second ceremony (spec: usernameless discovery design). */
  mode?: 'hinted' | 'discovery';
  /** The hinted user the pre-minted challenge belongs to (loader-resolved loginName).
   *  Empty in discovery mode — the discover response resolves it. */
  loginName: string;
  csrfToken: string;
  /** Pre-minted by the /login loader (base64url fields still encoded). Null → inert. */
  publicKeyCredentialRequestOptions: unknown;
  requestId?: string;
  organization?: string;
}

/** Read the Cypress seam flags (fake path — real conditional mediation can't run headless). */
function cypressSeam() {
  const w =
    typeof window !== 'undefined'
      ? (window as unknown as {
          Cypress?: unknown;
          __webAuthnRealCeremony?: boolean;
          __conditionalPasskeyAutoResolve?: boolean;
        })
      : undefined;
  return { w, fake: w?.Cypress !== undefined && !w?.__webAuthnRealCeremony };
}

/**
 * Arms the usernameless fast path: navigator.credentials.get({ mediation: 'conditional' })
 * over the loader-minted challenge. The promise parks until the user taps their passkey in
 * the browser's own autofill dropdown. HINTED mode submits the signed assertion to the
 * existing /login/passkey verify action; DISCOVERY mode first posts it to
 * /login/passkey-discover via plain fetch (identity resolution — the assertion is an
 * untrusted claim, only its userHandle is read server-side), then runs a MODAL ceremony
 * over the returned real challenge and submits THAT assertion to the verify action. The
 * verify submits are tagged passkeyCeremony so neither /login's nor /login/passkey's
 * loader re-mints mid-flight (the discover hop bypasses RR entirely — see submitDiscover).
 * ONE-SHOT by design: abort() — form submit, inline-ceremony takeover — permanently
 * retires it. Every failure is a designed NON-EVENT (the ordinary form is already on
 * screen). A rejected assertion re-fetches + re-arms exactly once in hinted mode; in
 * discovery mode it stops silently (a cross-device QR passkey must never be forced
 * through a second phone round-trip).
 */
export function useConditionalPasskey(input: ConditionalPasskeyInput) {
  const mode = input.mode ?? 'hinted';
  const challengeFetcher = useFetcher<WebAuthnVerifyLoaderData>();
  const submitFetcher = useFetcher();
  // Discovery's verify submission is STAGED through state + an effect rather than
  // dispatched straight from the fetch continuation: a fetcher.submit fired from a
  // deep async context can leave this instance's effect subscription stale (the
  // rejection effect never re-runs even though the fetcher data renders), while a
  // dispatch from inside an effect — the same context the hinted fake path uses —
  // is reliably observed. Correct-by-construction over scheduler-dependent.
  const [pendingVerify, setPendingVerify] = useState<{
    csrfToken: string;
    credential: Record<string, unknown>;
    loginName: string;
  } | null>(null);
  const [phase, setPhase] = useState<ConditionalPasskeyPhase>('idle');
  // Failure copy for EXPLICIT (button-initiated) discovery only — the ambient
  // conditional flow keeps every failure a silent non-event (spec error matrix).
  const [reason, setReason] = useState<WebAuthnReason | null>(null);
  const armedRef = useRef(false); // one-shot arming (also latched by abort())
  const retriedRef = useRef(false); // expired-challenge re-arm, once (hinted only)
  const abortedRef = useRef(false); // abort() latch for the async discovery stages
  const explicitRef = useRef(false); // true while a button-initiated (modal) flow runs
  const abortRef = useRef<AbortController | null>(null);

  const verifyPath = useCallback(
    (loginName: string) =>
      paths.login.passkey({
        loginName,
        requestId: input.requestId,
        organization: input.organization,
      }),
    [input.requestId, input.organization]
  );

  const submit = useCallback(
    (csrfToken: string, credential: Record<string, unknown>, loginName: string) => {
      setPhase('submitting');
      submitFetcher.submit(
        {
          csrf: csrfToken,
          credential: JSON.stringify(credential),
          loginName,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          ...(input.organization ? { organization: input.organization } : {}),
          // Read by /login's AND /login/passkey's shouldRevalidate (WEBAU-3M9si guard).
          passkeyCeremony: '1',
        },
        { method: 'post', action: verifyPath(loginName) }
      );
    },
    [input.requestId, input.organization, verifyPath, submitFetcher]
  );

  /** Discovery handoff: run the MODAL ceremony over the discover-returned real challenge. */
  const completeDiscovery = useCallback(async (d: DiscoverResponse) => {
    const { fake } = cypressSeam();
    if (fake) {
      // Headless can't run a modal ceremony; the pre-baked credential stands in for
      // assertion #2 exactly as it does for the other ceremony hooks.
      setPendingVerify({
        csrfToken: d.csrfToken,
        credential: CYPRESS_CREDENTIAL,
        loginName: d.loginName,
      });
      return;
    }
    try {
      const credential = await marshalAssertion(
        unwrapPublicKey(d.publicKeyCredentialRequestOptions) as WebAuthnChallengeInput
      );
      // The single biometric of the whole flow fires here (identity tap was UV
      // 'discouraged'; this real challenge is UV 'required').
      setPendingVerify({ csrfToken: d.csrfToken, credential, loginName: d.loginName });
    } catch {
      // Modal cancel / ceremony failure — designed non-event, never retried.
      setPhase('done');
    }
  }, []);

  // Staged verify dispatch (see the pendingVerify comment above).
  useEffect(() => {
    if (!pendingVerify || abortedRef.current) return;
    setPendingVerify(null);
    submit(pendingVerify.csrfToken, pendingVerify.credential, pendingVerify.loginName);
  }, [pendingVerify, submit]);

  /**
   * Discovery: post the identity assertion (assertion #1) to the discover action.
   * PLAIN fetch(), deliberately NOT an RR fetcher: this is a pure JSON API hop, and a
   * fetcher would drag in lazy route discovery plus a client route-module load
   * mid-ceremony — React Router hard-reloads the page when that load hiccups
   * (loadRouteModule → location.reload()), killing the armed ceremony — and would
   * trigger loader revalidation this hop has no use for. fetch() sends the csrf
   * cookie (same-origin default) and applies the response's Set-Cookie natively.
   */
  const submitDiscover = useCallback(
    async (csrfToken: string, credential: Record<string, unknown>) => {
      setPhase('submitting');
      try {
        const res = await fetch(`${APP_BASENAME}${paths.login.passkeyDiscover()}`, {
          method: 'POST',
          body: new URLSearchParams({ csrf: csrfToken, credential: JSON.stringify(credential) }),
        });
        if (abortedRef.current) return;
        if (!res.ok) {
          // Opaque 400 (unknown user, no passkey, mint failure). Ambient flow: designed
          // non-event. Explicit (button) flow: the user acted, so say something — the
          // 'not-allowed' copy ("cancelled, or no passkey for this account is available")
          // is the truthful fit (spec, open decision §3).
          if (explicitRef.current) setReason('not-allowed');
          setPhase('done');
          return;
        }
        const d = (await res.json()) as Partial<DiscoverResponse> | null;
        if (abortedRef.current) return;
        if (
          !d ||
          typeof d.loginName !== 'string' ||
          d.loginName.length === 0 ||
          typeof d.csrfToken !== 'string' ||
          !d.publicKeyCredentialRequestOptions
        ) {
          if (explicitRef.current) setReason('unknown');
          setPhase('done');
          return;
        }
        await completeDiscovery(d as DiscoverResponse);
      } catch {
        // Network failure / malformed body — non-event (ambient) or generic copy (explicit).
        if (explicitRef.current) setReason('unknown');
        setPhase('done');
      }
    },
    [completeDiscovery]
  );

  /**
   * EXPLICIT discovery (spec, open decision §3 as built): the Passkey button runs the
   * same discovery pipeline MODALLY — credentials.get over the loader's self-minted
   * options WITHOUT conditional mediation, so the browser opens its native picker
   * (including cross-device QR). Retires the ambient ceremony first (explicit intent
   * supersedes it, and clears a prior abort/cancel latch so the button works after the
   * user dismissed the ambient prompt). Returns false when it cannot start — discovery
   * not armed, WebAuthn unsupported, or a flow already in flight — so the caller can
   * fall back to the identifier step.
   */
  const beginDiscovery = useCallback((): boolean => {
    if (mode !== 'discovery' || !input.publicKeyCredentialRequestOptions) return false;
    if (phase === 'submitting') return false; // single-flight
    const { fake } = cypressSeam();
    if (!fake && !isWebAuthnSupported()) return false;
    abortRef.current?.abort();
    abortRef.current = null;
    armedRef.current = true; // the ambient conditional arm stays permanently retired
    abortedRef.current = false; // a prior abort() must not swallow THIS flow
    explicitRef.current = true;
    setReason(null);
    setPhase('submitting');
    void (async () => {
      if (fake) {
        // Explicit click under Cypress — the pre-baked credential IS the picked passkey
        // (same convention as WebAuthnButton's click path; no auto-resolve gate).
        await submitDiscover(input.csrfToken, CYPRESS_CREDENTIAL);
        return;
      }
      try {
        const credential = await marshalAssertion(
          unwrapPublicKey(input.publicKeyCredentialRequestOptions) as WebAuthnChallengeInput
          // no mediation option → MODAL picker
        );
        await submitDiscover(input.csrfToken, credential);
      } catch (err) {
        // Picker cancel / ceremony failure — the user acted, so surface the copy.
        setReason(err instanceof WebAuthnCeremonyError ? err.reason : 'unknown');
        setPhase('done');
      }
    })();
    return true;
  }, [mode, phase, input.publicKeyCredentialRequestOptions, input.csrfToken, submitDiscover]);

  const arm = useCallback(
    async (csrfToken: string, options: unknown) => {
      if (!options) return;
      // Cypress fake path — same gate as WebAuthnButton/usePasskeyLoginCeremony. Real
      // conditional mediation can't run headless; __conditionalPasskeyAutoResolve simulates
      // "the user tapped the passkey" with the pre-baked credential, and WITHOUT the flag
      // the ceremony parks in 'armed' (lets specs assert abort/no-fire behavior).
      const { w, fake } = cypressSeam();
      if (fake) {
        setPhase('armed');
        if (w?.__conditionalPasskeyAutoResolve) {
          if (mode === 'discovery') void submitDiscover(csrfToken, CYPRESS_CREDENTIAL);
          else submit(csrfToken, CYPRESS_CREDENTIAL, input.loginName);
        }
        return;
      }
      if (!isWebAuthnSupported()) return;
      const pkc = window.PublicKeyCredential as typeof PublicKeyCredential & {
        isConditionalMediationAvailable?: () => Promise<boolean>;
      };
      if (typeof pkc.isConditionalMediationAvailable !== 'function') return;
      if (!(await pkc.isConditionalMediationAvailable())) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase('armed');
      try {
        const credential = await marshalAssertion(
          unwrapPublicKey(options) as WebAuthnChallengeInput,
          { mediation: 'conditional', signal: controller.signal }
        );
        if (mode === 'discovery') void submitDiscover(csrfToken, credential);
        else submit(csrfToken, credential, input.loginName);
      } catch {
        // Deliberate abort() or a browser-side ceremony failure — designed non-events.
        setPhase('done');
      }
    },
    [mode, input.loginName, submit, submitDiscover]
  );

  // Arm once when enabled with a loader-minted challenge.
  useEffect(() => {
    if (!input.enabled || armedRef.current || !input.publicKeyCredentialRequestOptions) return;
    armedRef.current = true;
    void arm(input.csrfToken, input.publicKeyCredentialRequestOptions);
  }, [input.enabled, input.publicKeyCredentialRequestOptions, input.csrfToken, arm]);

  /** Retire the ceremony (the user stated explicit intent). One-shot — never re-arms. */
  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    armedRef.current = true; // latch: suppress any future arming
    abortedRef.current = true; // latch: suppress the async discovery handoff
    setPhase('done');
  }, []);

  // A rejected assertion returns DATA (a success is a redirect the fetcher follows).
  // Hinted: re-fetch a fresh challenge and re-arm exactly once, then stop silently.
  // Discovery: stop immediately — never force a second discover round-trip.
  useEffect(() => {
    if (phase !== 'submitting' || submitFetcher.state !== 'idle' || !submitFetcher.data) return;
    if (mode === 'discovery' || retriedRef.current) {
      setPhase('done');
      return;
    }
    retriedRef.current = true;
    setPhase('idle');
    challengeFetcher.load(verifyPath(input.loginName));
  }, [
    phase,
    mode,
    submitFetcher.state,
    submitFetcher.data,
    challengeFetcher,
    verifyPath,
    input.loginName,
  ]);

  // Retry completion (hinted only): the fresh challenge landed → re-arm with ITS csrf token.
  useEffect(() => {
    if (!retriedRef.current || phase !== 'idle' || challengeFetcher.state !== 'idle') return;
    const d = challengeFetcher.data;
    if (!d) return;
    void arm(d.csrfToken, d.publicKeyCredentialRequestOptions);
  }, [phase, challengeFetcher.state, challengeFetcher.data, arm]);

  return { abort, phase, reason, beginDiscovery };
}
