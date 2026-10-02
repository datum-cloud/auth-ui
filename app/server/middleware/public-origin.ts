import { env } from '@/server/infra/env.server';
import type { MiddlewareHandler } from 'hono';

/**
 * Rebuild `request` on the trusted public origin when it arrived on a different one.
 *
 * TLS ends at the gateway, so the pod sees `http://…` while the browser posts with
 * `Origin: https://…`. React Router 8.4 compares those full origins (scheme included)
 * before running any action and answers 400 on a mismatch. Re-basing request.url on
 * `PUBLIC_ORIGIN` keeps that CSRF check meaningful: an action passes only when the
 * browser's Origin is our real public origin. The host comes from config, never from
 * the client-controlled Host header (same rule as trustedAppOrigin).
 *
 * Returns the request untouched when `publicOrigin` is unset (dev / fake provider) or
 * already matches.
 */
export function withPublicOrigin(request: Request, publicOrigin: string | undefined): Request {
  if (!publicOrigin) return request;
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, publicOrigin);
  if (target.origin === url.origin) return request;
  // `duplex: 'half'` is required to forward a streaming body; RequestInit's DOM typing omits it.
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: request.redirect,
    signal: request.signal,
    ...(request.body ? { duplex: 'half' } : {}),
  };
  return new Request(target, init);
}

/** Hono middleware: re-base every request on PUBLIC_ORIGIN before routing. */
export const publicOrigin: MiddlewareHandler = async (c, next) => {
  c.req.raw = withPublicOrigin(c.req.raw, env.PUBLIC_ORIGIN);
  await next();
};
