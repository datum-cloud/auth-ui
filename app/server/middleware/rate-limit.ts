// ⚠️ CODE-MAJ-13 — SINGLE-REPLICA CONSTRAINT. This limiter holds state in an in-process Map,
// so counters are PER-REPLICA. At replicas > 1 the effective limit is (configured limit ×
// replica count) and an attacker's requests may scatter across pods. Until a shared Redis
// store is wired (tracked: REDIS-RATELIMIT follow-up), auth endpoints MUST run replicas: 1
// (or use sticky sessions). Do not scale this Deployment horizontally without the Redis fix.
import { logAuthEvent } from '@/server/observability';
import type { MiddlewareHandler } from 'hono';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}
interface Bucket {
  count: number;
  windowStart: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private opts: { limit: number; windowMs: number }) {}

  check(key: string, nowMs: number): RateLimitResult {
    // Fix 3: sweep expired buckets when the Map exceeds 10k entries to bound memory usage.
    if (this.buckets.size > 10_000) {
      for (const [k, b] of this.buckets) {
        if (nowMs - b.windowStart >= this.opts.windowMs) this.buckets.delete(k);
      }
    }
    const b = this.buckets.get(key);
    if (!b || nowMs - b.windowStart >= this.opts.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: nowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (b.count < this.opts.limit) {
      b.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    return { allowed: false, retryAfterMs: this.opts.windowMs - (nowMs - b.windowStart) };
  }
}

// CODE-MAJ-08: One shared limiter for GET /id/verify?send=true (email-code dispatch).
// The session-ownership gate (verify.tsx) already ensures only the owning user can trigger
// a send, but rate-limiting the GET path adds a defence-in-depth layer that bounds the
// worst-case email throughput from a single IP even before the ownership check.
// 10 attempts / 10 min per ip — more generous than login because users may legitimately
// reload the verify page (each reload with ?send=true is one email attempt).
// Key is ip-only: userId is a query param (no body-stream hazard), but including it would
// leak enumeration signal via timing if we ever log the key; ip-only is the safer choice.
const verifyEmailSendLimiter = new RateLimiter({ limit: 10, windowMs: 10 * 60_000 });

// Mounted on `/id/verify` in server.ts (or by callers who wire it).
// Self-guards on GET + normalized path; POST submits (code verification) are NOT limited
// here (they are already covered by the CSRF check and are not a flood vector).
export const verifyEmailSendRateLimit: MiddlewareHandler = async (c, next) => {
  const pathname = new URL(c.req.url).pathname.toLowerCase().replace(/\/+$/, '');
  if (c.req.method !== 'GET' || pathname !== '/id/verify') return next();

  const send = new URL(c.req.url).searchParams.get('send');
  if (send !== 'true') return next(); // only count ?send=true requests

  const xff = c.req.header('x-forwarded-for') ?? '';
  const ip = xff.split(',').at(-1)?.trim() || 'unknown';

  const { allowed, retryAfterMs } = verifyEmailSendLimiter.check(ip, Date.now());
  if (!allowed) {
    logAuthEvent('rate_limit', 'failure', { ip, path: pathname });
    return c.json(
      { error: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      429,
      { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }
    );
  }
  await next();
};

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
export const loginPasswordRateLimit: MiddlewareHandler = async (c, next) => {
  // Fix 1: Self-guarding match — Hono mounts are method-blind and stricter than RR7's route
  // matching (trailing-slash / case variants reach the RR7 action but bypass a path-equality
  // mount). Normalize and gate here; never trust the mount alone.
  const pathname = new URL(c.req.url).pathname.toLowerCase().replace(/\/+$/, '');
  if (c.req.method !== 'POST' || pathname !== '/id/login/password') return next();

  // Fix 2: XFF — take the LAST hop (appended by our gateway, e.g. Envoy).
  // Hop 0 is client-controlled: rotating it mints a fresh bucket per request, bypassing the
  // limiter entirely. EL: verify envoy-gateway clientIPDetection config and keep this pinned.
  const xff = c.req.header('x-forwarded-for') ?? '';
  const ip = xff.split(',').at(-1)?.trim() || 'unknown';

  // Fix 3: normalize loginName to bound key space (slice 128 + lowercase).
  // loginName is threaded into the URL by /login; if absent, the key degrades to ip-only.
  const rawLoginName = new URL(c.req.url).searchParams.get('loginName') ?? '';
  const loginName = rawLoginName.slice(0, 128).toLowerCase();

  // (Alternative when only the body has it: `const form = await c.req.raw.clone().formData()`.)
  const { allowed, retryAfterMs } = passwordLimiter.check(`${ip}|${loginName}`, Date.now());
  if (!allowed) {
    // Fix 5: emit audit event on 429 before responding.
    logAuthEvent('rate_limit', 'failure', { ip, loginName });
    return c.json(
      { error: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      429,
      { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }
    );
  }
  await next();
};

// Mounted on `/id/signup/*` in server.ts. Self-guards on POST + normalized path so the
// wider mount never limits GETs or unrelated sub-routes.
// BODY-STREAM HAZARD: same as loginPasswordRateLimit — key is taken from headers only.
// For /signup the email is in the POST body (not a URL param), so the key is ip-only.
// For /signup/password the loginName IS available as a URL param (?loginName=...) — we
// include it in the key when present so brute-force on a specific account is bounded.
export const signupRateLimit: MiddlewareHandler = async (c, next) => {
  const pathname = new URL(c.req.url).pathname.toLowerCase().replace(/\/+$/, '');
  if (c.req.method !== 'POST' || (pathname !== '/id/signup' && pathname !== '/id/signup/password'))
    return next();

  // XFF last-hop (same strategy as loginPasswordRateLimit).
  const xff = c.req.header('x-forwarded-for') ?? '';
  const ip = xff.split(',').at(-1)?.trim() || 'unknown';

  // For /signup/password the loginName is threaded as a URL param by signup.tsx.
  const rawLoginName = new URL(c.req.url).searchParams.get('loginName') ?? '';
  const loginName = rawLoginName.slice(0, 128).toLowerCase();
  const key = loginName ? `${ip}|${loginName}` : ip;

  const { allowed, retryAfterMs } = signupLimiter.check(key, Date.now());
  if (!allowed) {
    logAuthEvent('rate_limit', 'failure', {
      ip,
      loginName: loginName || undefined,
      path: pathname,
    });
    return c.json(
      { error: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      429,
      { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }
    );
  }
  await next();
};

// One shared limiter for /login/verify/* (TOTP, email OTP, SMS OTP): 10 attempts / 5 min per ip.
// loginName is in the POST body — key degrades to ip-only (body-stream hazard; cannot read body here).
const mfaVerifyLimiter = new RateLimiter({ limit: 10, windowMs: 5 * 60_000 });

// Mounted on `/id/login/verify/*` in server.ts. Self-guards on POST + normalized path prefix
// so only POST submits to the three verify screens are counted.
export const mfaVerifyRateLimit: MiddlewareHandler = async (c, next) => {
  const pathname = new URL(c.req.url).pathname.toLowerCase().replace(/\/+$/, '');
  if (c.req.method !== 'POST' || !pathname.startsWith('/id/login/verify/')) return next();

  const xff = c.req.header('x-forwarded-for') ?? '';
  const ip = xff.split(',').at(-1)?.trim() || 'unknown';

  const { allowed, retryAfterMs } = mfaVerifyLimiter.check(ip, Date.now());
  if (!allowed) {
    logAuthEvent('rate_limit', 'failure', { ip, path: pathname });
    return c.json(
      { error: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      429,
      { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }
    );
  }
  await next();
};

// One shared limiter for /sso/ldap: 5 attempts / 5 min per ip (matches loginPasswordRateLimit).
// Username is in the POST body — body-stream hazard means the key degrades to ip-only (cannot
// read the body without consuming the stream; same reasoning as signupRateLimit / mfaVerifyRateLimit).
const ldapLimiter = new RateLimiter({ limit: 5, windowMs: 5 * 60_000 });

// Mounted on `/id/sso/ldap` in server.ts. Self-guards on POST + normalized path.
// BODY-STREAM HAZARD: username and password are in the POST body — key is ip-only.
export const ldapRateLimit: MiddlewareHandler = async (c, next) => {
  const pathname = new URL(c.req.url).pathname.toLowerCase().replace(/\/+$/, '');
  if (c.req.method !== 'POST' || pathname !== '/id/sso/ldap') return next();

  const xff = c.req.header('x-forwarded-for') ?? '';
  const ip = xff.split(',').at(-1)?.trim() || 'unknown';

  const { allowed, retryAfterMs } = ldapLimiter.check(ip, Date.now());
  if (!allowed) {
    logAuthEvent('rate_limit', 'failure', { ip, path: pathname });
    return c.json(
      { error: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      429,
      { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }
    );
  }
  await next();
};

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
export const webauthnVerifyRateLimit: MiddlewareHandler = async (c, next) => {
  const pathname = new URL(c.req.url).pathname.toLowerCase().replace(/\/+$/, '');
  if (
    c.req.method !== 'POST' ||
    (pathname !== '/id/login/passkey' &&
      pathname !== '/id/login/security-key' &&
      pathname !== '/id/login/mfa')
  )
    return next();

  const xff = c.req.header('x-forwarded-for') ?? '';
  const ip = xff.split(',').at(-1)?.trim() || 'unknown';

  const { allowed, retryAfterMs } = webauthnVerifyLimiter.check(ip, Date.now());
  if (!allowed) {
    logAuthEvent('rate_limit', 'failure', { ip, path: pathname });
    return c.json(
      { error: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      429,
      { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }
    );
  }
  await next();
};

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
export const mfaEnrollRateLimit: MiddlewareHandler = async (c, next) => {
  const pathname = new URL(c.req.url).pathname.toLowerCase().replace(/\/+$/, '');
  if (c.req.method !== 'POST' || !pathname.startsWith('/id/setup/')) return next();

  const xff = c.req.header('x-forwarded-for') ?? '';
  const ip = xff.split(',').at(-1)?.trim() || 'unknown';

  const { allowed, retryAfterMs } = mfaEnrollLimiter.check(ip, Date.now());
  if (!allowed) {
    logAuthEvent('rate_limit', 'failure', { ip, path: pathname });
    return c.json(
      { error: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      429,
      { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }
    );
  }
  await next();
};

// One shared limiter for /accounts POST actions (session switch + remove): 15 attempts / 5 min per ip.
// The accounts page allows switching between concurrent Zitadel sessions and removing stale ones.
// 15/5min matches mfaEnrollRateLimit — the surface is session-gated and not a brute-force target,
// but scripted session cycling/removal from a compromised device should be throttled.
// BODY-STREAM HAZARD: action payloads (intent, sessionId) are in the POST body — key is ip-only.
const accountsLimiter = new RateLimiter({ limit: 15, windowMs: 5 * 60_000 });

// Mounted on `/id/accounts` in server.ts.
// Self-guards on POST + normalized path exact match.
// BODY-STREAM HAZARD: action type and sessionId are in the POST body — key is ip-only.
export const accountsRateLimit: MiddlewareHandler = async (c, next) => {
  const pathname = new URL(c.req.url).pathname.toLowerCase().replace(/\/+$/, '');
  if (c.req.method !== 'POST' || pathname !== '/id/accounts') return next();

  const xff = c.req.header('x-forwarded-for') ?? '';
  const ip = xff.split(',').at(-1)?.trim() || 'unknown';

  const { allowed, retryAfterMs } = accountsLimiter.check(ip, Date.now());
  if (!allowed) {
    logAuthEvent('rate_limit', 'failure', { ip, path: pathname });
    return c.json(
      { error: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      429,
      { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }
    );
  }
  await next();
};

// Mounted on `/id/password/reset` in server.ts. Self-guards on POST + normalized path.
// BODY-STREAM HAZARD: loginName is in the POST body — key is ip-only (cannot read body
// without consuming the stream). The ip-keyed response is inherently identical for known
// and unknown accounts, preserving enumeration safety at the rate-limit layer.
export const passwordResetRateLimit: MiddlewareHandler = async (c, next) => {
  const pathname = new URL(c.req.url).pathname.toLowerCase().replace(/\/+$/, '');
  if (c.req.method !== 'POST' || pathname !== '/id/password/reset') return next();

  // XFF last-hop (same strategy as loginPasswordRateLimit).
  const xff = c.req.header('x-forwarded-for') ?? '';
  const ip = xff.split(',').at(-1)?.trim() || 'unknown';

  const { allowed, retryAfterMs } = passwordResetLimiter.check(ip, Date.now());
  if (!allowed) {
    logAuthEvent('rate_limit', 'failure', { ip, path: pathname });
    return c.json(
      { error: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      429,
      { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }
    );
  }
  await next();
};
