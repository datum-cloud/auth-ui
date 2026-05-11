"use client";

import { useEffect } from "react";

/**
 * sessionStorage key under which we stash the MaxMind device-tracking token
 * captured by device.js. The register form reads it just before submitting so
 * the value can be forwarded to Zitadel as session metadata.
 */
export const MAXMIND_TOKEN_STORAGE_KEY = "datum.maxmind.trackingToken";

/**
 * Cookie set by MaxMind's device.js after a successful fingerprint exchange.
 * The cookie value is the tracking token; we mirror it into sessionStorage so
 * we don't have to parse document.cookie at submit time.
 */
const MAXMIND_COOKIE_NAME = "__mmapiwsid";

function readMaxMindCookie(): string {
  if (typeof document === "undefined") return "";
  const prefix = `${MAXMIND_COOKIE_NAME}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return "";
}

/**
 * MaxMindTracker loads the MaxMind minFraud device.js snippet on mount and
 * polls for the resulting __mmapiwsid cookie, mirroring it into
 * sessionStorage. Rendering is gated by NEXT_PUBLIC_MAXMIND_ACCOUNT_ID — if
 * unset the component is a no-op, so dev and preview deployments never
 * contact MaxMind.
 */
export function MaxMindTracker({ accountId }: { accountId: string }) {
  useEffect(() => {
    if (!accountId) return;
    if (typeof window === "undefined") return;

    const w = window as unknown as {
      __mmapiws?: { accountId?: string };
    };
    w.__mmapiws = w.__mmapiws || {};
    w.__mmapiws.accountId = accountId;

    // Load device.js (idempotent — guard against StrictMode double-mount).
    if (!document.querySelector('script[data-maxmind="device"]')) {
      const script = document.createElement("script");
      script.src = "https://device.maxmind.com/js/device.js";
      script.async = true;
      script.dataset.maxmind = "device";
      document.body.appendChild(script);
    }

    // Poll briefly for the tracking-token cookie. device.js sets it after
    // an async fingerprint exchange, typically within a few hundred ms.
    let attempts = 0;
    const maxAttempts = 30; // ~6 seconds at 200ms cadence
    const handle = window.setInterval(() => {
      attempts++;
      const token = readMaxMindCookie();
      if (token) {
        try {
          window.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, token);
        } catch {
          // sessionStorage may be disabled (private mode). Best-effort only.
        }
        window.clearInterval(handle);
        return;
      }
      if (attempts >= maxAttempts) {
        window.clearInterval(handle);
      }
    }, 200);

    return () => window.clearInterval(handle);
  }, [accountId]);

  return null;
}

/**
 * Returns the MaxMind device-tracking token captured during the session, or
 * undefined when none is available (sessionStorage blocked, MaxMind script
 * not yet finished, or NEXT_PUBLIC_MAXMIND_ACCOUNT_ID unset).
 */
export function readMaxMindTrackingToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.sessionStorage.getItem(MAXMIND_TOKEN_STORAGE_KEY);
    return value || undefined;
  } catch {
    return undefined;
  }
}
