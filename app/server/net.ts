// app/server/net.ts
//
// Shared network primitives for server middleware: client-IP extraction from the
// X-Forwarded-For header, and a factory that owns the common rate-limit middleware
// shape (pathname-normalize → IP-extract → check → audit-on-429 → 429 response).
import type { RateLimiter } from '@/server/middleware/rate-limit';
import { logAuthEvent } from '@/server/observability';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * Extract the LAST hop from an `X-Forwarded-For` value.
 *
 * Hop 0 is client-controlled: rotating it mints a fresh limiter bucket per request,
 * bypassing rate limiting entirely. Our gateway (e.g. Envoy) appends the real peer as
 * the final hop, so we always read `.at(-1)`. Returns `undefined` when no usable hop
 * is present (empty header, all-whitespace last hop) — callers pick their own fallback
 * (`?? 'unknown'` for rate-limit keys; an `if (ip)` guard in user-agent).
 */
export function lastHopIp(xff: string): string | undefined {
  return xff.split(',').at(-1)?.trim() || undefined;
}

/** Read the raw `x-forwarded-for` header off a Hono context (absent ⇒ ''). */
function xffOf(c: Context): string {
  return c.req.header('x-forwarded-for') ?? '';
}

/** Normalize a request pathname: lowercase + strip trailing slashes (mount-blind self-guard). */
function normalizedPathname(c: Context): string {
  return new URL(c.req.url).pathname.toLowerCase().replace(/\/+$/, '');
}

const RATE_LIMITED_BODY = {
  error: 'RATE_LIMITED',
  message: 'Too many attempts. Please try again later.',
} as const;

export interface CreateRateLimitOpts {
  /** The shared limiter instance (window + limit + store live here). */
  limiter: RateLimiter;
  /**
   * Self-guard: return `true` only for the exact method + normalized path (and any extra
   * conditions, e.g. a required query param) this middleware should count. Hono mounts are
   * method-blind and looser than RR7 routing, so every middleware MUST re-gate here.
   * Receives the already-normalized pathname to avoid re-parsing.
   */
  match: (c: Context, pathname: string) => boolean;
  /** Build the limiter key from the request + extracted IP (default fallback `'unknown'`). */
  key: (c: Context, ip: string) => string;
  /**
   * Audit fields logged on a 429 (alongside the implicit `rate_limit`/`failure` event).
   * Defaults to `{ ip, path }`. Receives the extracted IP and normalized pathname.
   */
  logFields?: (c: Context, ip: string, pathname: string) => Record<string, unknown>;
}

/**
 * Build a rate-limit middleware from a limiter + per-caller policy. Owns the boilerplate
 * shared by every auth limiter: normalize path → self-guard → extract last-hop IP →
 * `limiter.check` → emit `rate_limit`/`failure` audit + 429 with `Retry-After` on block.
 *
 * Behavior is byte-identical to the original hand-written middlewares: the IP fallback is
 * `'unknown'` (matching every rate-limit caller), the response body/headers are unchanged,
 * and the audit event name/outcome are fixed.
 */
export function createRateLimit(opts: CreateRateLimitOpts): MiddlewareHandler {
  const { limiter, match, key, logFields } = opts;
  return async (c, next) => {
    const pathname = normalizedPathname(c);
    if (!match(c, pathname)) return next();

    const ip = lastHopIp(xffOf(c)) ?? 'unknown';

    const { allowed, retryAfterMs } = limiter.check(key(c, ip), Date.now());
    if (!allowed) {
      const fields = logFields ? logFields(c, ip, pathname) : { ip, path: pathname };
      logAuthEvent('rate_limit', 'failure', fields);
      return c.json(RATE_LIMITED_BODY, 429, {
        'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
      });
    }
    await next();
  };
}
