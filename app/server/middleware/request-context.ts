import type { MiddlewareHandler } from 'hono';
import { AsyncLocalStorage } from 'node:async_hooks';

// secureHeadersNonce is set by hono/secure-headers when NONCE is used in the CSP.
// Declared here so c.get('secureHeadersNonce') typechecks in server.ts getLoadContext.
export type RequestContextEnv = { Variables: { traceId: string; secureHeadersNonce: string } };

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

// Module-level ALS that carries the traceId for the duration of each HTTP request.
// This lets logAuthEvent (and any other server utility) read the traceId without it
// being threaded through every call site.
//
// RR7 loader/action scope: react-router-hono-server registers the React Router request
// handler as the final Hono route.  `als.run` wraps `await next()` in the requestContext
// middleware, so the entire downstream Hono chain — including the RR handler — executes
// inside the ALS context.  Loaders and actions are called synchronously within that
// handler before response headers are flushed, so audit calls in actions/loaders are
// always within scope.
//
// SSR streaming caveat: chunks emitted during React's streaming render (after the initial
// flush) run in microtasks that may be outside the original ALS continuation if the stream
// is piped through native APIs that don't propagate AsyncResource context.  Audit calls
// belong in loaders/actions (before streaming begins), not in stream callbacks — so this
// is safe in practice.  This caveat is noted here for future stream-level observability work.
const als = new AsyncLocalStorage<{ traceId: string }>();

/**
 * Returns the traceId for the currently executing HTTP request, or undefined when
 * called outside an active ALS context (e.g. in unit tests or module-level code).
 */
export function getTraceId(): string | undefined {
  return als.getStore()?.traceId;
}

// CODE-MIN-31: test seam so the auto-injection path (getTraceId reading THIS module's ALS) is
// exercised end-to-end. The middleware already runs the handler chain inside als.run({ traceId });
// this wraps the identical store for unit tests without spinning up Hono.
export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  return als.run({ traceId }, fn);
}

export const requestContext: MiddlewareHandler<RequestContextEnv> = async (c, next) => {
  const inbound = c.req.header('x-request-id');
  const traceId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : crypto.randomUUID();
  c.set('traceId', traceId);

  // Tag the Sentry scope with the traceId for this request so every event emitted
  // during the request can be correlated back to server logs.
  // Lazy import avoids a circular dependency: sentry.server.ts imports env.server.ts
  // which must be initialised before this middleware module loads; a static import here
  // would pull sentry.server.ts into the module graph before entry.server.tsx can init
  // the SDK.  Dynamic import resolves after the module graph is fully evaluated.
  const { isSentryEnabled } = await import('@/server/sentry.server');
  if (isSentryEnabled) {
    const Sentry = await import('@sentry/react-router');
    Sentry.getCurrentScope().setTag('traceId', traceId);
  }

  // Run the rest of the middleware chain (including the RR handler) inside the ALS
  // context so getTraceId() works in any downstream server code without call-site churn.
  await als.run({ traceId }, async () => {
    await next();
  });
  c.header('x-request-id', traceId);
};
