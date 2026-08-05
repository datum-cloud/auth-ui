// Observability: initialise Sentry FIRST so the SDK is active before any
// application modules load.  This import is a no-op when SENTRY_DSN is unset.
import { captureException } from '@/server/sentry.server';
import { cspNonceContext } from '@/shared/load-context';
import { createReadableStreamFromReadable } from '@react-router/node';
import { isbot } from 'isbot';
import { PassThrough } from 'node:stream';
// Import the explicit Node entry: under the bun runtime, bare 'react-dom/server'
// resolves to server.bun.js (Web Streams only — no renderToPipeableStream). This SSR
// path uses Node streams (PassThrough + @react-router/node), so pin the node build.
import { renderToPipeableStream } from 'react-dom/server.node';
import type { EntryContext, HandleErrorFunction, RouterContextProvider } from 'react-router';
import { ServerRouter } from 'react-router';

// RR7 streamTimeout convention: how long to wait for the shell before aborting.
// The abort timer fires streamTimeout + 1 000 ms after the shell deadline passes.
export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  loadContext: RouterContextProvider
) {
  const callbackName = isbot(request.headers.get('user-agent') ?? '')
    ? 'onAllReady'
    : 'onShellReady';

  const cspNonce = loadContext.get(cspNonceContext);

  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    // eslint-disable-next-line prefer-const -- assigned after renderToPipeableStream so closures can reference it; cannot be const
    let abortTimer: ReturnType<typeof setTimeout>;

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} nonce={cspNonce} />,
      {
        // Thread the per-request CSP nonce so React marks inline scripts with it.
        // Undefined in dev (Hono uses 'unsafe-inline' there instead of NONCE).
        nonce: cspNonce,
        [callbackName]() {
          shellRendered = true;
          clearTimeout(abortTimer);

          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set('Content-Type', 'text/html');

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          clearTimeout(abortTimer);
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );

    // Start the abort timer after renderToPipeableStream so `abort` is in scope.
    // Wrapped in an arrow rather than passed by reference: taint analysers treat the first
    // argument of setTimeout as a code-execution sink (browser setTimeout evals a string),
    // and `abort` is destructured from a call that received `request.url`, so it reads as
    // attacker-derived. A literal function expression has no provenance to trace. Behaviour
    // is unchanged — with no trailing args setTimeout invokes the callback with none, so
    // this calls `abort()` exactly as the bare reference did.
    abortTimer = setTimeout(() => abort(), streamTimeout + 1_000);
  });
}

/**
 * React Router v7 server error hook.
 * Captures loader/action errors in Sentry (no-op when SENTRY_DSN is unset).
 * Aborted requests (client navigated away) are intentionally skipped.
 */
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (!request.signal.aborted) {
    captureException(error);
    console.error(error);
  }
};
