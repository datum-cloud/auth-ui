/**
 * Observability: env-gated Sentry server init.
 *
 * Import this module ONCE, early in the server entry (entry.server.tsx or server.ts).
 * When SENTRY_DSN is unset the module exports a no-op `captureException` and an
 * `isSentryEnabled` flag so callers can skip scope operations cheaply.
 *
 * Tracing level on Bun / react-router-hono-server
 * ─────────────────────────────────────────────────
 * @sentry/react-router's server init wraps @sentry/node which uses OpenTelemetry
 * under the hood. Bun does support the OTel Node.js SDK via the same AsyncLocalStorage
 * primitives, so automatic HTTP/loader/action spans ARE generated when the SDK is
 * initialised. However, auto-instrumentation of Node built-in `http` does not apply to
 * Bun's native fetch — outbound fetch calls will NOT produce child spans automatically
 * unless wrapped manually. In practice this means:
 *
 *   ✓  Error capture via captureException (full stack traces, breadcrumbs)
 *   ✓  Request-level root spans for incoming HTTP requests (via @sentry/node httpIntegration)
 *   ✓  React Router loader/action spans (via createSentryHandleError / handleError wiring)
 *   ✓  traceId tag on every event (via Sentry.getCurrentScope().setTag in requestContext)
 *   ~  Outbound fetch spans: not auto-instrumented on Bun; wrap with Sentry.startSpan() if needed
 *
 * The `instrument.server.mjs` --import pattern described in the README requires an ESM
 * preload mechanism.  With react-router-hono-server/bun the entry point is executed by
 * Bun directly (not via react-router-serve), so we import this module first inside
 * entry.server.tsx instead — that achieves the same effect of initialising the SDK
 * before any application code runs in the module graph.
 */
import { env } from '@/server/infra/env.server';
import { beforeSend, beforeSendTransaction } from '@/server/sentry-scrub';
import * as Sentry from '@sentry/react-router';

export const isSentryEnabled: boolean = Boolean(env.SENTRY_DSN);

if (isSentryEnabled) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // Keep integrations minimal — no source-map upload here (that belongs in the
    // Vite build plugin which requires SENTRY_AUTH_TOKEN; skipped until cutover).
    environment: env.NODE_ENV,
    // Egress neutrality: ALLOWLIST scrubber — every event/transaction is
    // reduced to safe fields before it leaves the process. Raw provider/proto
    // detail + PII stay in the server log keyed by traceId (see sentry-scrub.ts).
    beforeSend,
    beforeSendTransaction,
  });
}

/**
 * Captures an exception in Sentry when enabled; otherwise is a no-op.
 * Prefer this over importing Sentry directly so callers don't need to guard
 * on isSentryEnabled themselves.
 */
export function captureException(error: unknown): void {
  if (isSentryEnabled) {
    Sentry.captureException(error);
  }
}
