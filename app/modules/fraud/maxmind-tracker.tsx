import { useEffect, type RefObject } from 'react';

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

/**
 * Reads the device-tracking token at form-submit time.
 *
 * Checks sessionStorage first (the fast path — the tracker polls the cookie and mirrors it
 * there on success). If the mirror is absent (e.g. the MaxMind cookie landed after the poll
 * budget expired), falls back to reading the cookie directly and mirrors it so future reads
 * are fast. This prevents the token from being permanently lost on slow connections.
 */
export function readMaxMindTrackingToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const mirrored = window.sessionStorage.getItem(MAXMIND_TOKEN_STORAGE_KEY);
    if (mirrored) return mirrored;
  } catch {
    // sessionStorage unavailable — fall through to cookie read
  }
  // Fallback: cookie may have arrived after the poll budget expired.
  const fromCookie = readMaxMindCookie();
  if (!fromCookie) return undefined;
  // Mirror it so subsequent reads (e.g. the signup interval) find it immediately.
  try {
    window.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, fromCookie);
  } catch {
    // sessionStorage unavailable; the cookie read still returns the token this call.
  }
  return fromCookie;
}

/**
 * Closes the fast-signup race: the periodic mirror-sync effect on each signup screen only
 * copies the token into the hidden `deviceTrackingToken` input on an interval (every ~300ms),
 * so a user who fills the form and submits within that window — or before device.js has even
 * captured the cookie — can send an EMPTY token even though `readMaxMindTrackingToken()` would
 * return one a moment later.
 *
 * Call this from the form's `onSubmit`, synchronously, before that handler snapshots FormData —
 * the signup forms all do. A button `onClick` fires only for the trigger it is attached to, so a
 * form that submits natively on Enter sends a stale value. signup/password.tsx is the last
 * `onClick` caller and carries that gap; tolerable only because the route is retired.
 *
 * No-op when no token has been captured yet (leaves whatever the input already carries, e.g. the
 * server-round-tripped value from an earlier screen) or when the ref isn't attached.
 */
export function syncMaxMindTokenToRef(ref: RefObject<HTMLInputElement | null>): void {
  const token = readMaxMindTrackingToken();
  if (token && ref.current) {
    ref.current.value = token;
  }
}
