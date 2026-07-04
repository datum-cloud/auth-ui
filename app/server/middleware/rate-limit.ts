// ⚠️ SINGLE-REPLICA OPERATIONAL GUARD.
// By DEFAULT this limiter holds state in an in-process Map (the `InMemoryRateLimitStore`
// adapter), so counters are PER-REPLICA. At replicas > 1 the effective limit is (configured
// limit × replica count) and an attacker's requests may scatter across pods. Until the shared
// store is PROVISIONED — set `RATE_LIMIT_REDIS_URL` to a reachable redis:// / rediss:// endpoint
// to select the `RedisRateLimitStore` sliding-window adapter — auth endpoints MUST run
// `replicas: 1` (or use sticky sessions). Do not scale this Deployment horizontally without the
// shared store. The store seam is pluggable (see rate-limit-store.ts); the DEFAULT (env unset)
// path is byte-identical to the original embedded Map, so CI / the fitness gate need no Redis.
import { InMemoryRateLimitStore, type RateLimitStore } from '@/server/middleware/rate-limit-store';
import { createRateLimit } from '@/server/net';
import { hashActor } from '@/server/observability';
import type { Context, MiddlewareHandler } from 'hono';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Synchronous fixed-window limiter used by every auth middleware below. The COUNTING is
 * delegated to a pluggable `RateLimitStore`; the default (and the only synchronous) adapter is
 * the in-process `InMemoryRateLimitStore`, preserving the original observable behavior exactly.
 * A store may be injected for tests or for a future shared-store wiring (see rate-limit-store.ts
 * + `selectRateLimitStore`). The shared Redis adapter is async, so swapping it into this sync
 * path is intentionally a follow-up; the seam exists here and is unit-tested today.
 */
export class RateLimiter {
  // Typed to the RateLimitStore INTERFACE (not the concrete in-memory class) so the Redis adapter
  // is a real injection seam. `check` is synchronous, so it requires a synchronous store; an async
  // (Redis) store must be driven by an async middleware variant via selectRateLimitStore, not here.
  private store: RateLimitStore;

  constructor(
    private opts: { limit: number; windowMs: number },
    store: RateLimitStore = new InMemoryRateLimitStore()
  ) {
    this.store = store;
  }

  check(key: string, nowMs: number): RateLimitResult {
    const result = this.store.incr(key, this.opts.windowMs, nowMs);
    // Narrow the union return (sync result | Promise) instead of an unsafe cast: the sync limiter
    // requires a synchronous store. A Promise here means an async store was wrongly injected.
    if (result instanceof Promise) {
      throw new Error('RateLimiter.check requires a synchronous RateLimitStore (got async)');
    }
    const { count, resetAt } = result;
    if (count <= this.opts.limit) {
      return { allowed: true, retryAfterMs: 0 };
    }
    return { allowed: false, retryAfterMs: Math.max(0, resetAt - nowMs) };
  }
}

// One shared limiter for GET /id/verify?send=true (email-code dispatch).
// The session-ownership gate (verify.tsx) already ensures only the owning user can trigger
// a send, but rate-limiting the GET path adds a defence-in-depth layer that bounds the
// worst-case email throughput from a single IP even before the ownership check.
// 10 attempts / 10 min per ip — more generous than login because users may legitimately
// reload the verify page (each reload with ?send=true is one email attempt).
// Key is ip-only: userId is a query param (no body-stream hazard), but including it would
// leak enumeration signal via timing if we ever log the key; ip-only is the safer choice.
const verifyEmailSendLimiter = new RateLimiter({ limit: 10, windowMs: 10 * 60_000 });

// Mounted on `/id/verify` in server.ts (or by callers who wire it).
// Guards two surfaces:
//   GET  /id/verify?send=true  -- the auto email-code dispatch from the loader.
//   POST /id/verify (intent=resend) -- the manual Resend button action.
// Both are email-send vectors; the service-layer ownership gate is the primary
// defence, but rate-limiting here adds a defence-in-depth layer that bounds
// worst-case email throughput from a single IP even before the ownership check.
export const verifyEmailSendRateLimit: MiddlewareHandler = createRateLimit({
  limiter: verifyEmailSendLimiter,
  match: (c, pathname) => {
    if (pathname !== '/id/verify') return false;
    if (c.req.method === 'GET') return new URL(c.req.url).searchParams.get('send') === 'true';
    // POST resend: intent=resend is in the body (body-stream hazard) -- key on method alone.
    // The ownership gate in resendEmailCode provides the per-account defence;
    // this limiter caps the per-IP email-send rate as a backstop.
    return c.req.method === 'POST';
  },
  key: (_c, ip) => ip,
});

// One shared limiter for /login/password: 5 attempts / 5 min per (ip + loginName).
const passwordLimiter = new RateLimiter({ limit: 5, windowMs: 5 * 60_000 });

// One shared limiter for /password/reset: 5 attempts / 10 min per ip.
// loginName is in the POST body — body-stream hazard means we key on ip-only here
// (same strategy as signupLimiter for /signup). The rate-limit response is identical
// for known and unknown accounts because the key is ip-based, not account-based.
const passwordResetLimiter = new RateLimiter({ limit: 5, windowMs: 10 * 60_000 });

// One shared limiter for /signup (and /signup/password): 10 attempts / 10 min per ip.
// Email is available in the form body — not a URL param for /signup/password — so the key
// degrades to ip-only (avoids the body-stream hazard; see loginPasswordRateLimit comment).
// 10/10min is more generous than login because registration is a one-time flow.
const signupLimiter = new RateLimiter({ limit: 10, windowMs: 10 * 60_000 });

// Mounted on `/id/login/*` in server.ts (covers trailing-slash/case variants that Hono's
// stricter matching would miss). The middleware self-guards method + normalized path so the
// wider mount never accidentally limits unrelated sub-routes or non-POST verbs.
//
// BODY-STREAM HAZARD: the RR7 action downstream calls `await request.formData()`. A Hono
// `request` body stream can be read only once, so we must NOT consume the original body here.
// Take the rate-limit key from the URL/headers (cheap, non-consuming). If the loginName is
// needed in the key, read it from a `?loginName` query param threaded by /login, or clone the
// request first (`c.req.raw.clone()`) and parse the clone — never the original.
// Fix 1: Self-guarding match — Hono mounts are method-blind and stricter than RR7's route
// matching (trailing-slash / case variants reach the RR7 action but bypass a path-equality
// mount). The factory normalizes + gates via `match`; never trust the mount alone.
// Fix 2: XFF last-hop (the factory's lastHopIp) — hop 0 is client-controlled. EL: verify
// envoy-gateway clientIPDetection config and keep this pinned.
// Fix 3: normalize loginName to bound key space (slice 128 + lowercase). loginName is threaded
// into the URL by /login; if absent the key degrades to ip-only.
// Fix 5: the factory emits the `rate_limit`/`failure` audit event on 429 before responding.
// (Alternative when only the body has it: `const form = await c.req.raw.clone().formData()`.)
const normalizedLoginName = (c: Context): string =>
  (new URL(c.req.url).searchParams.get('loginName') ?? '').slice(0, 128).toLowerCase();

export const loginPasswordRateLimit: MiddlewareHandler = createRateLimit({
  limiter: passwordLimiter,
  match: (c, pathname) => c.req.method === 'POST' && pathname === '/id/login/password',
  key: (c, ip) => `${ip}|${normalizedLoginName(c)}`,
  logFields: (c, ip) => ({ ip, actor: hashActor(normalizedLoginName(c)) }),
});

// Mounted on `/id/signup/*` in server.ts. Self-guards on POST + normalized path so the
// wider mount never limits GETs or unrelated sub-routes.
// BODY-STREAM HAZARD: same as loginPasswordRateLimit — key is taken from headers only.
// For /signup the email is in the POST body (not a URL param), so the key is ip-only.
// For /signup/password the loginName IS available as a URL param (?loginName=...) — we
// include it in the key when present so brute-force on a specific account is bounded.
// For /signup/password the loginName is threaded as a URL param by signup.tsx; for /signup the
// email is in the POST body (body-stream hazard) so the key degrades to ip-only.
export const signupRateLimit: MiddlewareHandler = createRateLimit({
  limiter: signupLimiter,
  match: (c, pathname) =>
    c.req.method === 'POST' && (pathname === '/id/signup' || pathname === '/id/signup/password'),
  key: (c, ip) => {
    const loginName = normalizedLoginName(c);
    return loginName ? `${ip}|${loginName}` : ip;
  },
  logFields: (c, ip, pathname) => {
    const loginName = normalizedLoginName(c);
    return { ip, actor: loginName ? hashActor(loginName) : undefined, path: pathname };
  },
});

// One shared limiter for /login/verify/* (TOTP, email OTP, SMS OTP): 10 attempts / 5 min per ip.
// loginName is in the POST body — key degrades to ip-only (body-stream hazard; cannot read body here).
const mfaVerifyLimiter = new RateLimiter({ limit: 10, windowMs: 5 * 60_000 });

// Mounted on `/id/login/verify/*` in server.ts. Self-guards on POST + normalized path prefix
// so only POST submits to the three verify screens are counted.
export const mfaVerifyRateLimit: MiddlewareHandler = createRateLimit({
  limiter: mfaVerifyLimiter,
  match: (c, pathname) => c.req.method === 'POST' && pathname.startsWith('/id/login/verify/'),
  key: (_c, ip) => ip,
});

// One shared limiter for /sso/ldap: 5 attempts / 5 min per ip (matches loginPasswordRateLimit).
// Username is in the POST body — body-stream hazard means the key degrades to ip-only (cannot
// read the body without consuming the stream; same reasoning as signupRateLimit / mfaVerifyRateLimit).
const ldapLimiter = new RateLimiter({ limit: 5, windowMs: 5 * 60_000 });

// Mounted on `/id/sso/ldap` in server.ts. Self-guards on POST + normalized path.
// BODY-STREAM HAZARD: username and password are in the POST body — key is ip-only.
export const ldapRateLimit: MiddlewareHandler = createRateLimit({
  limiter: ldapLimiter,
  match: (c, pathname) => c.req.method === 'POST' && pathname === '/id/sso/ldap',
  key: (_c, ip) => ip,
});

// One shared limiter for WebAuthn verification ceremonies: 10 attempts / 5 min per ip.
// Covers three POST surfaces: /login/passkey, /login/security-key, /login/mfa.
// The assertion body (clientDataJSON, authenticatorData, etc.) is in the POST body —
// body-stream hazard means the key degrades to ip-only (cannot read body without consuming
// the stream, same reasoning as mfaVerifyRateLimit). 10/5min mirrors mfaVerifyRateLimit
// because these are verification ceremonies where Zitadel's own failedAttempts policy
// provides the per-account lockout backstop; the limiter here guards against scripted
// credential-stuffing and enumeration from a single IP.
const webauthnVerifyLimiter = new RateLimiter({ limit: 10, windowMs: 5 * 60_000 });

// Mounted on `/id/login/*` in server.ts alongside loginPasswordRateLimit.
// Self-guards on POST + exact normalized paths to avoid double-limiting:
//   - loginPasswordRateLimit already covers /id/login/password
//   - mfaVerifyRateLimit already covers /id/login/verify/*
// This middleware only counts its three exact paths, so no overlap occurs.
// BODY-STREAM HAZARD: assertion payloads are in the POST body — key is ip-only.
// mfaVerifyRateLimit keying decision (2026-06-12): ip-only stays. Body-stream hazard
// prevents reading loginName without consuming the stream; the per-account lockout
// protection lives in Zitadel's failedAttempts policy, not in this middleware.
export const webauthnVerifyRateLimit: MiddlewareHandler = createRateLimit({
  limiter: webauthnVerifyLimiter,
  match: (c, pathname) =>
    c.req.method === 'POST' &&
    (pathname === '/id/login/passkey' ||
      pathname === '/id/login/security-key' ||
      pathname === '/id/login/mfa'),
  key: (_c, ip) => ip,
});

// One shared limiter for MFA enrollment flows: 15 attempts / 5 min per ip.
// Covers five POST surfaces: /setup/passkey, /setup/security-key, /setup/authenticator,
// /setup/email, /setup/sms, and /setup/mfa (the skip/confirm POST).
// 15/5min is slightly more generous than login verification (10/5min) because enrollment
// happens once per credential and requires a logged-in session (RR7 session guard provides
// an outer auth layer), so raw brute-forcing is already bounded; the limiter here guards
// against scripted abuse from compromised sessions.
// BODY-STREAM HAZARD: enrollment payloads are in the POST body — key is ip-only (same
// reasoning as all other POST-body limiters in this file).
const mfaEnrollLimiter = new RateLimiter({ limit: 15, windowMs: 5 * 60_000 });

// Mounted on `/id/setup/*` in server.ts.
// Self-guards on POST + normalized path prefix — all /id/setup/* enrollment POSTs.
// BODY-STREAM HAZARD: enrollment payloads are in the POST body — key is ip-only.
export const mfaEnrollRateLimit: MiddlewareHandler = createRateLimit({
  limiter: mfaEnrollLimiter,
  match: (c, pathname) => c.req.method === 'POST' && pathname.startsWith('/id/setup/'),
  key: (_c, ip) => ip,
});

// One shared limiter for /accounts POST actions (session switch + remove): 15 attempts / 5 min per ip.
// The accounts page allows switching between concurrent Zitadel sessions and removing stale ones.
// 15/5min matches mfaEnrollRateLimit — the surface is session-gated and not a brute-force target,
// but scripted session cycling/removal from a compromised device should be throttled.
// BODY-STREAM HAZARD: action payloads (intent, sessionId) are in the POST body — key is ip-only.
const accountsLimiter = new RateLimiter({ limit: 15, windowMs: 5 * 60_000 });

// Mounted on `/id/accounts` in server.ts.
// Self-guards on POST + normalized path exact match.
// BODY-STREAM HAZARD: action type and sessionId are in the POST body — key is ip-only.
export const accountsRateLimit: MiddlewareHandler = createRateLimit({
  limiter: accountsLimiter,
  match: (c, pathname) => c.req.method === 'POST' && pathname === '/id/accounts',
  key: (_c, ip) => ip,
});

// Mounted on `/id/password/reset` in server.ts. Self-guards on POST + normalized path.
// BODY-STREAM HAZARD: loginName is in the POST body — key is ip-only (cannot read body
// without consuming the stream). The ip-keyed response is inherently identical for known
// and unknown accounts, preserving enumeration safety at the rate-limit layer.
export const passwordResetRateLimit: MiddlewareHandler = createRateLimit({
  limiter: passwordResetLimiter,
  match: (c, pathname) => c.req.method === 'POST' && pathname === '/id/password/reset',
  key: (_c, ip) => ip,
});
