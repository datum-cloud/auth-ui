import type { MiddlewareHandler } from 'hono';
import { secureHeaders, NONCE } from 'hono/secure-headers';

/**
 * Pure CSP directive builder — extracted so the policy is unit-testable without
 * standing up the Hono middleware. Returned object is passed verbatim as
 * `secureHeaders({ contentSecurityPolicy: cspDirectives(isDev) })`.
 */
const LOCKED_DOWN: readonly string[] = ["'none'"];

/**
 * Resolve the CSP `frame-ancestors` source list from a raw env value
 * env.server.ts). Secure by default: unset / empty / wildcard / unparseable all
 * collapse to 'none' (the auth UI is not embeddable). Environments that MUST embed
 * the auth UI (e.g. staging) set an explicit allowlist of full origins, space- or
 * comma-separated, e.g. "https://staging.portal.example.com".
 *
 * A bare `*` is rejected outright — a wildcard frame-ancestors defeats clickjacking
 * protection. Accepted sources: `self`/`'self'` and concrete http(s) origins.
 */
export function resolveFrameAncestors(raw: string | undefined): string[] {
  if (!raw) return ["'none'"];
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  // Empty or wildcard → lock down. `'none'` is exclusive (cannot combine with sources).
  if (tokens.length === 0 || tokens.some((t) => t === '*')) return ["'none'"];
  if (tokens.some((t) => t === 'none' || t === "'none'")) return ["'none'"];
  const sources = tokens.map(normalizeFrameAncestor).filter((t): t is string => t !== null);
  return sources.length > 0 ? sources : ["'none'"];
}

function normalizeFrameAncestor(token: string): string | null {
  if (token === 'self' || token === "'self'") return "'self'";
  try {
    const u = new URL(token);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.origin === 'null') return null; // unsupported/opaque host forms
    return u.origin; // scheme://host[:port], any path stripped
  } catch {
    return null;
  }
}

/** True when framing is fully denied (the secure default). */
function framingLockedDown(frameAncestors: readonly string[]): boolean {
  return frameAncestors.length === 1 && frameAncestors[0] === "'none'";
}

export function cspDirectives(isDev: boolean, frameAncestors: readonly string[] = LOCKED_DOWN) {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: isDev
      ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
      : ["'self'", NONCE, "'strict-dynamic'"],
    // Production drops 'unsafe-inline' and uses the per-request nonce
    // (mirrors scriptSrc); dev keeps 'unsafe-inline' for HMR-injected styles.
    styleSrc: isDev ? ["'self'", "'unsafe-inline'"] : ["'self'", NONCE],
    imgSrc: ["'self'", 'data:', 'https:'],
    // Fathom analytics beacons POST to https://cdn.usefathom.com — without this
    // connect-src entry the browser blocks them. script-src needs no change:
    // 'strict-dynamic' already trusts scripts injected by our nonce'd bundle.
    connectSrc: ["'self'", 'https://cdn.usefathom.com', ...(isDev ? ['ws:'] : [])],
    // Secure default 'none' (the auth UI is not embeddable). Override per-environment
    // via FRAME_ANCESTORS (parsed by resolveFrameAncestors) when an embed is required,
    // e.g. a staging portal. X-Frame-Options in appSecureHeaders is reconciled to match.
    frameAncestors: [...frameAncestors],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
  };
}

export function appSecureHeaders(
  isDev: boolean,
  frameAncestors: readonly string[] = LOCKED_DOWN
): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: cspDirectives(isDev, frameAncestors),
    strictTransportSecurity: isDev ? false : 'max-age=63072000; includeSubDomains; preload',
    xContentTypeOptions: 'nosniff',
    // X-Frame-Options is a coarse legacy header (DENY | SAMEORIGIN only — no allowlist).
    // Keep DENY ONLY while frame-ancestors is locked to 'none' (consistent). Once an
    // allowlist is configured, OMIT XFO (false) and rely on CSP frame-ancestors —
    // otherwise XFO:DENY would block the very embed the allowlist is meant to permit.
    xFrameOptions: framingLockedDown(frameAncestors) ? 'DENY' : false,
    // P7 Task 8: tightened from origin-when-cross-origin (P0 review work item) —
    // never leak path/query to other origins; same-origin keeps the full URL.
    referrerPolicy: 'strict-origin-when-cross-origin',
    // P7 Task 8 (P0 carry-over): deny powerful features the auth UI never uses.
    // publickey-credentials-get stays self — WebAuthn ceremonies need it.
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
      usb: [],
      publickeyCredentialsGet: ['self'],
    },
  });
}
