/**
 * Observability — client-side Sentry init (env-gated, no-op by default).
 *
 * Mirrors sentry.server.ts on the browser side: when no client DSN is configured
 * this is a true no-op (no SDK init, no network). When a DSN IS present, the SDK
 * is initialised with the SAME ALLOWLIST scrubber as the server so any
 * browser-side capture is reduced to safe fields before it leaves the page —
 * no loginName/identifier, token-bearing URL, cookie, or provider/proto string
 * ever reaches Sentry from the client.
 *
 * The DSN is read from a BUILD-TIME Vite var (`import.meta.env.VITE_SENTRY_DSN`)
 * rather than window.ENV — this app deliberately has no window.ENV machinery
 * (see env.server.ts). Unset ⇒ disabled everywhere, exactly like the server.
 *
 * Import this once at the top of entry.client.tsx so the SDK is active before
 * hydration runs.
 */
import { beforeSend, beforeSendTransaction } from '@/server/sentry-scrub';
import * as Sentry from '@sentry/react-router';

const dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN;

export const isClientSentryEnabled: boolean = Boolean(dsn);

export function initClientSentry(): void {
  if (!isClientSentryEnabled) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // No tracing on the client by default (no tracesSampleRate) — error capture
    // only. The SAME egress allowlist as the server; raw detail never leaves.
    beforeSend,
    beforeSendTransaction,
  });
}
