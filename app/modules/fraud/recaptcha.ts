import { useCallback, useEffect } from 'react';

const MINT_TIMEOUT_MS = 5_000;

/**
 * Loads reCAPTCHA v3's script and returns a submit-time token minter.
 *
 * No-op when `siteKey` is empty, so an unconfigured deployment ships no script.
 * The minter never throws and never hangs: execute() can reject or stall, so it races
 * a timer and resolves to undefined, letting the submit proceed without a token.
 *
 * Mint at submit, never on mount — tokens expire in ~2 minutes. Callers pass their own
 * action name and must not share one between forms, or the server rejects the token as
 * an action mismatch.
 */
export function useRecaptcha(siteKey: string): (action: string) => Promise<string | undefined> {
  useEffect(() => {
    if (!siteKey) return;
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
    script.async = true;
    document.head.appendChild(script);
    return () => script.remove();
  }, [siteKey]);

  return useCallback(
    async (action: string): Promise<string | undefined> => {
      if (!siteKey || !window.grecaptcha) return undefined;
      try {
        return await Promise.race<string | undefined>([
          window.grecaptcha.execute(siteKey, { action }),
          new Promise((resolve) => {
            window.setTimeout(() => resolve(undefined), MINT_TIMEOUT_MS);
          }),
        ]);
      } catch {
        return undefined;
      }
    },
    [siteKey]
  );
}
