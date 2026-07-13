import { load, trackPageview, trackEvent } from 'fathom-client';
import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Identity-free auth conversion events. Privacy: NO user id / sub / org is ever
 * sent to Fathom (unlike cloud-portal, which scopes events by identity).
 * Deferred (server-redirect flows, no terminal render): password_changed, mfa_enrolled.
 */
export type AuthEventName =
  | 'signup_submitted'
  | 'email_verified'
  | 'password_reset_requested'
  | 'logout_completed'
  | 'login_completed';

/**
 * Pure, server-safe gate: expose the Fathom site id to the client ONLY in
 * production AND only when an id is configured. Dev/preview never contact Fathom.
 * Called from the root loader; unit-tested in isolation.
 */
export function resolveFathomSiteId(
  nodeEnv: string,
  fathomId: string | undefined
): string | undefined {
  return nodeEnv === 'production' && fathomId ? fathomId : undefined;
}

/**
 * Thin wrapper over fathom-client's trackEvent. Safe to call even when Fathom
 * never loaded (no siteId) — fathom-client no-ops until load() runs.
 */
export function trackAuthEvent(name: AuthEventName): void {
  trackEvent(name);
}

/**
 * Mounted once at the app root inside the existing providers. Renders nothing.
 * On mount: load(siteId, { auto: false }) — we drive pageviews manually so SPA
 * navigations are counted. On every location path/search change (including the
 * first render): trackPageview(). Renders null (and never loads) when siteId is falsy.
 */
export function FathomAnalytics({ siteId }: { siteId?: string }): null {
  const location = useLocation();

  useEffect(() => {
    if (!siteId) return;
    load(siteId, { auto: false });
  }, [siteId]);

  useEffect(() => {
    if (!siteId) return;
    trackPageview();
  }, [siteId, location.pathname, location.search]);

  return null;
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
