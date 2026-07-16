// app/modules/analytics/rybbit.server.ts
//
// Server-side counterpart to app/modules/analytics/rybbit.tsx's client-only trackAuthEvent.
// Needed because some signup moments never render an auth-ui page at all — an IdP
// (Google/GitHub) signup that completes mid-OIDC-ceremony redirects the browser straight from
// the headless /sso/:provider/callback loader to /authorize (also headless) and on to the
// relying party (e.g. cloud-portal), so there is no client to mount <TrackOnMount> on. This
// posts directly to Rybbit's HTTP tracking API instead.
import type { AuthEventName } from '@/modules/analytics/rybbit';
import { env } from '@/server/infra/env.server';
import { logAuthEvent } from '@/server/observability';

const RYBBIT_TRACK_URL = 'https://app.rybbit.io/api/track';

interface TrackServerEventInput {
  /** The Zitadel/Milo user id, so this event stitches to the user's later cloud-portal events. */
  userId?: string;
  properties?: Record<string, unknown>;
}

/**
 * Fire-and-forget: never awaited by callers, never throws, never blocks the response. A
 * failure here should not affect auth — it's only logged (as `rybbit_server_track` in the
 * snake_case audit-event inventory) for our own observability.
 */
export function trackServerEvent(
  eventName: AuthEventName,
  input: TrackServerEventInput = {}
): void {
  const siteId = env.RYBBIT_SITE_ID;
  if (!siteId) return;

  const body: Record<string, unknown> = {
    site_id: siteId,
    type: 'custom_event',
    event_name: eventName,
  };
  if (input.userId) body.user_id = input.userId;
  if (input.properties) body.properties = JSON.stringify(input.properties);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Optional: an unauthenticated call still tracks, just without Rybbit's bot/domain-spoofing
  // protection. See app/server/infra/env.server.ts for the RYBBIT_API_KEY contract.
  if (env.RYBBIT_API_KEY) headers.Authorization = `Bearer ${env.RYBBIT_API_KEY}`;

  fetch(RYBBIT_TRACK_URL, { method: 'POST', headers, body: JSON.stringify(body) })
    .then((res) => {
      if (!res.ok) {
        logAuthEvent('rybbit_server_track', 'failure', { eventName, status: res.status });
      }
    })
    .catch((err) => {
      logAuthEvent('rybbit_server_track', 'failure', {
        eventName,
        reason: err instanceof Error ? err.message : String(err),
      });
    });
}
