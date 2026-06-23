// app/server/user-agent.ts
//
// Builds the Zitadel UserAgent shape from a Web API Request, and ensures the
// `fingerprintId` cookie the OLD app minted keeps existing for browsers that
// never carried it (cleared cookies / a browser that never visited the old app).
// Ported from the old app's getUserAgent() in apps/login/src/lib/fingerprint.ts
// (commit d78f91a101), adapted for the rebuilt server (no Next.js dependency).
//
// Shape produced (Zitadel v2 UserAgent):
//   { fingerprintId?, ip?, description?, header?: { 'user-agent': { values: string[] } } }
//
// IP extraction reuses the same last-hop XFF strategy as rate-limit.ts:
//   xff.split(',').at(-1)?.trim()
// This is the single source of truth for proxy trust.
//
// 755-M2: send the RAW user-agent string in BOTH `header['user-agent']` and
// `description`. milo-os/graphql-gateway runs the Bowser library over whichever
// field maps to `status.userAgent`, and Bowser only detects OS/browser from a
// real UA string (it keys off raw tokens like `Macintosh`). The earlier M1
// approach (comma-split header + a custom comma-joined description) fragmented
// the UA at its internal `(KHTML, like Gecko)` comma and gave Bowser nothing
// parseable, so Active-Sessions showed `os: null`. Sending the raw UA fixes it.

export interface ZitadelUserAgent {
  fingerprintId?: string;
  ip?: string;
  description?: string;
  header?: Record<string, { values: string[] }>;
}

// ── fingerprintId cookie ─────────────────────────────────────────────────────

const FINGERPRINT_COOKIE = 'fingerprintId';

/**
 * Reads the `fingerprintId` cookie from the request's Cookie header.
 *
 * The OLD app set this cookie (httpOnly, 1-year) via getOrSetFingerprintId()
 * and sent its value as the Zitadel UserAgent fingerprintId. The browser still
 * carries it, so we read it back here when no explicit id is supplied. Returns
 * an empty string when the cookie is absent.
 */
function fingerprintIdFromCookie(request: Request): string {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return '';
  }

  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    if (name === FINGERPRINT_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }

  return '';
}

// One year, matching the OLD app's setFingerprintIdCookie (maxAge: 31536000).
const FINGERPRINT_MAX_AGE_SECONDS = 31536000;

/**
 * Serializes the `fingerprintId` Set-Cookie string with the SAME attributes the
 * OLD app used (apps/login/src/lib/fingerprint.ts → setFingerprintIdCookie):
 * httpOnly, Path=/, Max-Age=1y. Plus SameSite=Lax and Secure (in production) —
 * additive hardening the OLD Next.js call omitted, harmless for a fingerprint
 * cookie that is never read by client scripts.
 *
 * Serialized by hand (not via createCookie) so the stored value is the BARE uuid —
 * byte-identical to what an old-app browser already carries — and round-trips
 * losslessly through fingerprintIdFromCookie's decodeURIComponent.
 */
function serializeFingerprintCookie(id: string, secure: boolean): string {
  const attrs = [
    `${FINGERPRINT_COOKIE}=${encodeURIComponent(id)}`,
    `Max-Age=${FINGERPRINT_MAX_AGE_SECONDS}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensures a `fingerprintId` exists for this request.
 *
 * - Cookie PRESENT → returns its value and a `null` setCookie (reuse, no re-mint;
 *   mirrors getCsrfToken's "null when already set" convention so callers skip the
 *   redundant Set-Cookie).
 * - Cookie ABSENT → mints `crypto.randomUUID()` and returns it alongside a
 *   Set-Cookie that callers append to the SAME request's response. The minted id is
 *   passed to `userAgentFromRequest(request, id)` so the very first login already
 *   carries the fingerprintId (no first-session gap).
 *
 * `secure` defaults to production so the cookie is not flagged Secure on plain-http
 * local dev (where it would otherwise be dropped by the browser).
 */
export function getOrCreateFingerprintId(
  request: Request,
  secure: boolean = process.env.NODE_ENV === 'production'
): [string, string | null] {
  const existing = fingerprintIdFromCookie(request);
  if (existing) {
    return [existing, null];
  }
  const id = crypto.randomUUID();
  return [id, serializeFingerprintCookie(id, secure)];
}

/**
 * Builds a Zitadel v2 UserAgent object from a Web API Request.
 *
 * - header: maps `user-agent` → `{ values: [ua] }` (single raw UA string)
 * - ip: last-hop from `x-forwarded-for` (same proxy-trust model as rate-limit.ts)
 * - description: the raw UA string (Bowser parses browser/OS from it downstream)
 * - fingerprintId: the explicit param if given, else the `fingerprintId` cookie
 *
 * Empty fields are omitted from the returned object.
 */
export function userAgentFromRequest(request: Request, fingerprintId?: string): ZitadelUserAgent {
  const result: ZitadelUserAgent = {};

  // fingerprintId: explicit param overrides the cookie; fall back to the cookie
  // the browser already carries (set by the OLD app, 1-year httpOnly).
  const fp = fingerprintId || fingerprintIdFromCookie(request);
  if (fp) {
    result.fingerprintId = fp;
  }

  // IP: last-hop XFF — mirrors the rate-limit middleware strategy exactly.
  const xff = request.headers.get('x-forwarded-for') ?? '';
  const ip = xff.split(',').at(-1)?.trim() || '';
  if (ip) {
    result.ip = ip;
  }

  // UA header → header shape + description.
  // 755-M2: send the FULL raw UA as a SINGLE header value (do NOT comma-split —
  // that fragments the UA at `(KHTML, like Gecko)` and breaks Bowser). The raw UA
  // is also mirrored into `description` because milo's gateway runs Bowser over
  // whichever field it maps to `status.userAgent`.
  const ua = request.headers.get('user-agent');
  if (ua) {
    result.header = { 'user-agent': { values: [ua] } };
    result.description = ua;
  }

  return result;
}
