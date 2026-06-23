// app/server/user-agent.ts
//
// Builds the Zitadel UserAgent shape from a Web API Request.
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

// ── Public API ───────────────────────────────────────────────────────────────

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
