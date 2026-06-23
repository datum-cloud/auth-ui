/**
 * Egress neutrality — the Sentry `beforeSend` ALLOWLIST scrubber.
 *
 * The single neutrality boundary on the egress side: NO proto type, provider
 * string, or PII (loginName/identifiers, tokens, cookies, request bodies) may
 * leave the process via Sentry. This is an ALLOWLIST — we construct a fresh
 * event from ONLY the fields explicitly known to be safe and DROP everything
 * else. (A denylist would silently leak any future field the SDK adds.)
 *
 * Raw provider/proto detail is NOT lost: it stays in the server log keyed by
 * `traceId` (see observability.ts / app-error-map.ts), never sent to Sentry or
 * the browser. The `traceId` tag (set in request-context.ts) survives here so an
 * SRE can pivot from a scrubbed Sentry event to the full server log line.
 *
 * Pure + framework-free so it can be unit-tested against a synthetic hostile
 * event AND wired into both the server (`sentry.server.ts`) and client
 * (`sentry.client.ts`) Sentry inits via `beforeSend`.
 */
import type { AppErrorCode } from '@/shared/errors/app-error';
import type { ErrorEvent, Event } from '@sentry/react-router';

// @sentry/react-router re-exports Event/ErrorEvent but not TransactionEvent;
// a transaction event is just an Event with the discriminating type tag.
type TransactionEvent = Event & { type: 'transaction' };

// The closed set of AppErrorCodes — used to coerce an exception's neutral
// type/value down to a known code (anything unrecognised → UNEXPECTED).
const APP_ERROR_CODES: readonly AppErrorCode[] = [
  'INVALID_INPUT',
  'INVALID_CREDENTIALS',
  'SESSION_EXPIRED',
  'NO_SUPPORTED_METHOD',
  'PASSWORD_NOT_ALLOWED',
  'RATE_LIMITED',
  'FORBIDDEN',
  'CONFLICT',
  'UNEXPECTED',
];

// Tags safe to leave the process. `traceId` correlates back to the server log;
// `code` is a neutral AppErrorCode. Everything else is dropped — a tag is an
// arbitrary string set anywhere and must never be trusted to be PII-free.
const ALLOWED_TAGS: readonly string[] = ['traceId', 'code', 'environment'];

// contexts.trace fields safe to keep. Deliberately EXCLUDES `data` and `tags`,
// which carry arbitrary span attributes (e.g. http.url with query tokens).
const ALLOWED_TRACE_KEYS = ['trace_id', 'span_id', 'parent_span_id', 'op', 'status'] as const;

// mechanism.type is normally an SDK-set enum, but it is a free string field —
// allowlist the known-safe SDK values and map anything else to 'generic' so no
// arbitrary/provider string can ride out via the mechanism.
const ALLOWED_MECHANISM_TYPES = [
  'generic',
  'instrument',
  'onerror',
  'onunhandledrejection',
  'unhandledrejection',
] as const;

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && (APP_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Reduce a single exception to its neutral shape: a known AppErrorCode as both
 * type and value, plus the (safe) handled/synthetic mechanism flags. Drops the
 * raw provider/proto `value`, the `module`, and the entire stacktrace (frame
 * vars routinely carry loginName + tokens).
 */
function neutralExceptionCode(type?: string, value?: string): AppErrorCode {
  if (isAppErrorCode(type)) return type;
  if (isAppErrorCode(value)) return value;
  return 'UNEXPECTED';
}

function scrubExceptionValues(event: Event): Event['exception'] {
  const values = event.exception?.values;
  if (!values || values.length === 0) return undefined;
  return {
    values: values.map((ex) => {
      const code = neutralExceptionCode(ex.type, ex.value);
      return {
        type: code,
        value: code,
        // The mechanism's handled/synthetic/type fields are booleans/enums, not PII.
        ...(ex.mechanism
          ? {
              mechanism: {
                handled: ex.mechanism.handled,
                synthetic: ex.mechanism.synthetic,
                type: (ALLOWED_MECHANISM_TYPES as readonly string[]).includes(ex.mechanism.type)
                  ? ex.mechanism.type
                  : 'generic',
              },
            }
          : {}),
        // No stacktrace, no module — they leak source paths + frame vars.
      };
    }),
  };
}

function scrubTags(tags: Event['tags']): Event['tags'] {
  if (!tags) return undefined;
  const out: NonNullable<Event['tags']> = {};
  for (const key of ALLOWED_TAGS) {
    const v = tags[key];
    if (v !== undefined && v !== null) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function scrubTrace(contexts: Event['contexts']): Event['contexts'] {
  const trace = contexts?.trace;
  if (!trace) return undefined;
  const safeTrace: Record<string, unknown> = {};
  for (const key of ALLOWED_TRACE_KEYS) {
    const v = (trace as Record<string, unknown>)[key];
    if (v !== undefined) safeTrace[key] = v;
  }
  // trace_id/span_id are required on a real TraceContext; if neither survived
  // there is nothing safe to keep.
  if (safeTrace.trace_id === undefined && safeTrace.span_id === undefined) return undefined;
  return { trace: safeTrace } as Event['contexts'];
}

/**
 * The allowlist scrubber. Returns a freshly-built event containing ONLY safe
 * fields, or `null` to drop the event entirely. Generic over Error and
 * Transaction events so the same function backs `beforeSend` and
 * `beforeSendTransaction`.
 *
 * Everything not explicitly copied below is dropped — including `message`,
 * `logentry`, `user`, `request` (url/cookies/headers/body/query_string),
 * `extra`, `breadcrumbs`, `server_name`, `modules`, `fingerprint`, and any
 * non-`trace` context block.
 */
export function scrubEvent<E extends Event>(event: E): E | null {
  if (!event) return null;

  const exception = scrubExceptionValues(event);
  const tags = scrubTags(event.tags);
  const contexts = scrubTrace(event.contexts);

  // Build a minimal Event from the allowlisted primitives, then re-narrow to E
  // (ErrorEvent | TransactionEvent) by carrying the discriminating `type`.
  const safe: Event = {
    ...(event.event_id !== undefined ? { event_id: event.event_id } : {}),
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    ...(event.start_timestamp !== undefined ? { start_timestamp: event.start_timestamp } : {}),
    ...(event.level !== undefined ? { level: event.level } : {}),
    ...(event.platform !== undefined ? { platform: event.platform } : {}),
    ...(event.release !== undefined ? { release: event.release } : {}),
    ...(event.environment !== undefined ? { environment: event.environment } : {}),
    type: event.type,
    ...(exception ? { exception } : {}),
    ...(tags ? { tags } : {}),
    ...(contexts ? { contexts } : {}),
    // Transaction events: the transaction NAME is the route pattern (low
    // cardinality, no PII — same source as the metrics `route` label) so it is
    // safe to keep for performance grouping.
    ...(event.type === 'transaction' && event.transaction !== undefined
      ? { transaction: event.transaction }
      : {}),
  };

  return safe as E;
}

/** `beforeSend` hook: scrubs error events (and feedback/other non-txn events). */
export function beforeSend(event: ErrorEvent): ErrorEvent | null {
  return scrubEvent(event);
}

/** `beforeSendTransaction` hook: scrubs performance/transaction events. */
export function beforeSendTransaction(event: TransactionEvent): TransactionEvent | null {
  return scrubEvent(event);
}
