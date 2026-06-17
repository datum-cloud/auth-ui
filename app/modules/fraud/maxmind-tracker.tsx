import { useEffect } from 'react';

/** sessionStorage key the captured MaxMind device-tracking token is mirrored under. */
export const MAXMIND_TOKEN_STORAGE_KEY = 'datum.maxmind.trackingToken';

/** The cookie MaxMind's device.js writes the tracking token into. */
const MAXMIND_COOKIE_NAME = '__mmapiwsid';

/** Poll cadence + budget: 30 attempts × 200ms ≈ 6s for device.js to set the cookie. */
const POLL_INTERVAL_MS = 200;
const MAX_POLL_ATTEMPTS = 30;

function readMaxMindCookie(): string {
  if (typeof document === 'undefined') return '';
  const prefix = `${MAXMIND_COOKIE_NAME}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return '';
}

interface MaxMindTrackerProps {
  /** MaxMind minFraud account id. Empty ⇒ the tracker is a true no-op. */
  accountId: string;
}

/**
 * Loads MaxMind's device.js (idempotent, StrictMode-safe), polls the __mmapiwsid
 * cookie, and mirrors the captured token into sessionStorage so the signup form can
 * read it at submit. Renders nothing. No-op when accountId is empty.
 */
export function MaxMindTracker({ accountId }: MaxMindTrackerProps) {
  useEffect(() => {
    if (!accountId || typeof window === 'undefined') return;

    const w = window as unknown as { __mmapiws?: { accountId?: string } };
    w.__mmapiws = w.__mmapiws || {};
    w.__mmapiws.accountId = accountId;

    // Idempotent: only inject device.js once (survives React StrictMode double-mount).
    if (!document.querySelector('script[data-maxmind="device"]')) {
      const script = document.createElement('script');
      script.src = 'https://device.maxmind.com/js/device.js';
      script.async = true;
      script.dataset.maxmind = 'device';
      document.body.appendChild(script);
    }

    let attempts = 0;
    const handle = window.setInterval(() => {
      attempts++;
      const token = readMaxMindCookie();
      if (token) {
        try {
          window.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, token);
        } catch {
          // sessionStorage may be unavailable (private mode); failing to mirror is non-fatal.
        }
        window.clearInterval(handle);
        return;
      }
      if (attempts >= MAX_POLL_ATTEMPTS) window.clearInterval(handle);
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(handle);
  }, [accountId]);

  return null;
}

/** Reads the mirrored device-tracking token at form-submit time. */
export function readMaxMindTrackingToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage.getItem(MAXMIND_TOKEN_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}
