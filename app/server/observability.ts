import { getTraceId } from '@/server/middleware/request-context';
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { createHash } from 'node:crypto';
import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const authEvents = new Counter({
  name: 'auth_events_total',
  help: 'Auth ceremony events',
  labelNames: ['event', 'outcome'],
  registers: [registry],
});

// HTTP request duration histogram — labels: method, route, status_code.
// "route" uses the Hono matched path pattern (e.g. /id/login/password), not
// the raw URL, so high-cardinality identifiers (user IDs in query params, etc.)
// don't explode label cardinality.
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  // Buckets span the full latency range relevant to an auth UI:
  // sub-ms static assets → multi-second IdP redirects.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// Hono middleware that records http_request_duration_seconds for every request.
// Mount it as the very first middleware (app.use('*', httpMetrics)) so the
// timer starts before any other middleware runs.
export const httpMetrics: MiddlewareHandler = async (c, next) => {
  const end = httpRequestDuration.startTimer();
  try {
    await next();
  } finally {
    end({
      method: c.req.method,
      // routePath() returns the matched Hono path pattern (e.g. /id/login/password),
      // keeping label cardinality bounded. Fall back to raw path for 404s or
      // if the match result is unavailable (e.g. very early middleware errors).
      route: (() => {
        try {
          return routePath(c) || c.req.path;
        } catch {
          return c.req.path;
        }
      })(),
      status_code: String(c.res?.status ?? 500),
    });
  }
};

// Audit actorRef pseudonymization. Audit logs must never carry a raw loginName or
// email. Callers pass hashActor(loginName) at the identifier stage and the resolved userId
// once available. Truncated SHA-256 (first 16 hex chars) is collision-safe for audit
// correlation and non-reversible. Empty input → '' (no actor identified yet).
export function hashActor(loginName: string): string {
  if (!loginName) return '';
  return createHash('sha256').update(loginName).digest('hex').slice(0, 16);
}

// Injectable logger keeps the helper deterministic and unit-testable (default = console.log).
type LogSink = (line: string) => void;

// ONE named default audit sink. Structured audit lines are compliance-relevant;
// centralising the default here means a deployment that needs to redirect audit output (e.g. to
// a file or a dedicated stream when stdout capture is unreliable) changes exactly one place,
// instead of an implicit console.log buried in a default parameter at every call site.
// eslint-disable-next-line no-console -- intentional audit log sink (the only allowed console site)
export const auditSink: LogSink = (line) => console.log(line);

// Structured audit log + metric. Flow actions (Phases 1–5) call this.
//
// REQUEST-SCOPED TRACING: traceId is now injected automatically via AsyncLocalStorage —
// no call-site changes required.  The ALS context is established by the requestContext
// Hono middleware (app/server/middleware/request-context.ts) which wraps the entire
// downstream handler chain (including the RR7 loader/action handler) in als.run().
// logAuthEvent reads the traceId from getTraceId() and appends it to the JSON log line.
//
// NOTE: traceId is intentionally NOT added to Prometheus counter labels — it is
// unbounded (one value per request) and would cause label-cardinality explosion in
// prom-client / Prometheus.  It appears in the structured log line only.
//
// If a caller also passes traceId in `fields`, the fields value takes precedence (spread
// order: ALS value first, fields last), allowing explicit override in tests or replay scenarios.
//
// SENTRY TRACING GAP (Phase 7 Task 5): @sentry/react-router@^10.5.0 is installed but
// has NO server-side init (no instrument.ts, no SENTRY_DSN env var, no transaction
// wrapping in server.ts).  Adding Sentry server init requires a SENTRY_DSN secret and
// a controller decision on whether to run @sentry/node's OpenTelemetry auto-instrumentation
// alongside the existing prom-client metrics pipeline.  This is documented here and
// deferred to that decision — do not add @sentry/node.init() without approval.
//
// EVENT NAMING CONVENTION — FROZEN AS-IS
// ────────────────────────────────────────
// The event names below are the canonical audit-event inventory.  Two naming
// conventions coexist in this codebase because they were introduced in separate
// phases.  Do NOT mass-rename either group: doing so silently breaks P4-era audit
// history and the Prometheus alert rules that regex-match event names directly
// (specifically: password_check|ldap_signin|idp\.signin — those three are pinned).
//
//   Phase 4 era — dot-case:
//     idp.signin  idp.link  idp.link.denied  idp.link.start  idp.unlink
//     password.change  password.reset.completed  password.reset.requested
//     signup.requested  signup.created
//     email.verified  invite.verified
//
//   Phase 5+ era — snake_case:
//     password_check  ldap_signin  identifier  idp_start
//     mfa_method_chosen  mfa_totp  mfa_otp_challenge  mfa_otp
//     mfa_enroll  mfa_enroll_challenge  mfa_skip
//     mfa_passkey  mfa_passkey_challenge  mfa_u2f  mfa_u2f_challenge
//     account_switch  account_remove
//     authrequest_resolve  oidc_callback  saml_response
//     device_code_lookup  device_authorize
//     logout  rate_limit
//     post_login_redirect  post_login_settings  post_login_admin_check
//     post_login_identity_fetch
//     rybbit_server_track
//
// NEW events must use snake_case.
export function logAuthEvent(
  event: string,
  outcome: 'success' | 'failure',
  fields: Record<string, unknown> = {},
  log: LogSink = auditSink
) {
  // Increment Prometheus counter — no traceId label (unbounded cardinality).
  authEvents.inc({ event, outcome });

  // Build the log payload: ALS traceId is injected when present; explicit fields
  // can override it (useful for tests and replay scenarios).
  const alsTraceId = getTraceId();
  const traceField: Record<string, unknown> =
    alsTraceId !== undefined ? { traceId: alsTraceId } : {};

  log(
    JSON.stringify({ level: 'info', kind: 'auth_event', event, outcome, ...traceField, ...fields })
  );
}
