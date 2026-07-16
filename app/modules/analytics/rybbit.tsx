import { useEffect } from 'react';

declare global {
  interface Window {
    rybbit?: {
      event: (name: string, properties?: Record<string, unknown>) => void;
      identify: (userId: string, traits?: Record<string, unknown>) => void;
      clearUserId: () => void;
      pageview: () => void;
    };
  }
}

/** Traits with special handling in Rybbit's dashboard — see identifyUser. */
export interface RybbitUserTraits {
  email?: string;
  name?: string;
  username?: string;
  [key: string]: unknown;
}

/**
 * Auth conversion events. Unlike the old Fathom integration, these ARE stitched to identity
 * (see identifyUser below) — both this app and cloud-portal report to the same Rybbit site, and
 * Rybbit's identify() is per-origin, so each app calls it once it knows the user.
 * Deferred (server-redirect flows, no terminal render): password_changed, mfa_enrolled.
 */
export type AuthEventName =
  | 'signup_submitted'
  | 'email_verified'
  | 'password_reset_requested'
  | 'logout_completed'
  | 'login_completed';

/**
 * Pure gate: normalizes an empty/unset site id to undefined. Rybbit is active in every
 * environment (staging, preview, production) once RYBBIT_SITE_ID is configured — no
 * environment-based gating. Called from the root loader; unit-tested in isolation.
 */
export function resolveRybbitSiteId(siteId: string | undefined): string | undefined {
  return siteId || undefined;
}

/**
 * Thin wrapper over window.rybbit.event. Safe to call even when the Rybbit script never
 * loaded (no siteId) — no-ops until the script tag has run.
 */
export function trackAuthEvent(name: AuthEventName): void {
  if (typeof window === 'undefined') return;
  window.rybbit?.event(name);
}

/**
 * Stitches this app's events to the same user's events in cloud-portal. Call once the
 * authenticated user's id is known (e.g. on the terminal /signed-in page). Traits are
 * optional metadata shown in Rybbit's dashboard — email/name/username get special
 * display treatment there; anything else is a plain custom field.
 */
export function identifyUser(userId: string, traits?: RybbitUserTraits): void {
  if (typeof window === 'undefined') return;
  if (traits) {
    window.rybbit?.identify(userId, traits);
  } else {
    window.rybbit?.identify(userId);
  }
}

/**
 * Clears the stored user id so a shared/public device doesn't keep attributing
 * events to the previous user after logout. Call once, on the terminal logout page.
 */
export function clearIdentifiedUser(): void {
  if (typeof window === 'undefined') return;
  window.rybbit?.clearUserId();
}

interface RybbitAnalyticsProps {
  /** Rybbit Cloud site id. Renders nothing when falsy. */
  siteId?: string;
  /** `data-tag` cohort-segmentation attribute, e.g. "production" / "staging" / "preview". */
  tag?: string;
  /** The request's CSP script-src nonce. */
  nonce?: string;
}

/**
 * Renders the Rybbit script tag directly (per Rybbit's Remix integration guide — mounted in
 * root.tsx's <head>). No manual pageview tracking: SPA route-change tracking is automatic once
 * enabled in the Rybbit site's dashboard settings.
 */
export function RybbitAnalytics({ siteId, tag, nonce }: RybbitAnalyticsProps) {
  if (!siteId) return null;
  return (
    <script
      src="https://app.rybbit.io/api/script.js"
      data-site-id={siteId}
      data-tag={tag}
      nonce={nonce}
      defer
    />
  );
}

/**
 * Fires a single conversion event once when mounted. Place in a terminal render
 * branch (e.g. a "check your email" success view). Renders null.
 */
export function TrackOnMount({ event }: { event: AuthEventName }): null {
  useEffect(() => {
    trackAuthEvent(event);
    // Fire exactly once per mount; event is a stable string-literal prop.
  }, []);

  return null;
}
