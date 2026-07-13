import type { MiddlewareHandler } from 'hono';

const LEGACY_RE = /^\/ui\/v2\/login(\/.*)?$/;
const NEW_PREFIX = '/id';
const INDEX = '/login'; // unknown/bare targets land on the login index (→ /id/login)

// Explicit fork→rebuild route renames that external callers hardcode (exact-match on the tail).
const RENAMES: Record<string, string> = {
  '/idp/link': '/sso/link',
  '/loginname': '/login',
  '/register': '/signup',
};

// Known top-level /id routes (from app/routes.ts) — the validation allow-list.
// Keep in sync when a top-level route is added.
// Note: segments like 'password', 'setup', 'verify' that can also appear as login sub-routes
// are omitted here; when seen under /ui/v2/login, they're treated as login sub-paths only if known.
const KNOWN_SEGMENTS: ReadonlySet<string> = new Set([
  'login',
  'signup',
  'sso',
  'device',
  'logout',
  'accounts',
  'signed-in',
  'error',
  'authorize',
]);

// Known /login sub-routes from routes.ts login layout
const LOGIN_SUBROUTES: ReadonlySet<string> = new Set([
  'method',
  'password',
  'mfa',
  'passkey',
  'security-key',
  'verify',
]);

/**
 * Map a legacy `/ui/v2/login/*` path to its `/id/*` target, or null when `pathname` is not a
 * legacy path (the middleware then falls through to the router). Unknown targets collapse to the
 * login index — we never 301 into a 404 or to an arbitrary path.
 */
export function legacyRedirectTarget(pathname: string, search: string): string | null {
  const m = LEGACY_RE.exec(pathname);
  if (!m) return null;
  const rest = m[1] ?? ''; // '' | '/' | '/idp/link' | '/login/password' | '/password' | '/bogus' | ...
  let tail = RENAMES[rest] ?? rest;
  if (tail === '' || tail === '/') tail = INDEX; // bare → /login

  const parts = tail.split('/').filter(Boolean); // ['login', 'password'] or ['password'] or []
  if (parts.length === 0) {
    tail = INDEX;
  } else if (parts.length === 1) {
    // Single segment: check if it's a known top-level route
    const seg = parts[0];
    if (KNOWN_SEGMENTS.has(seg)) {
      tail = '/' + seg;
    } else if (LOGIN_SUBROUTES.has(seg)) {
      // It's a known login sub-route, make it /login/<seg>
      tail = INDEX + '/' + seg;
    } else {
      // Unknown segment → fall back to index
      tail = INDEX;
    }
  } else {
    // Multi-segment: check if first segment is known
    const firstSeg = parts[0];
    if (KNOWN_SEGMENTS.has(firstSeg)) {
      tail = '/' + parts.join('/');
    } else {
      // Unknown first segment or path → fall back to index
      tail = INDEX;
    }
  }

  return `${NEW_PREFIX}${tail}${search}`;
}

/** Hono middleware: 301 any legacy `/ui/v2/login/*` request to its `/id/*` equivalent. */
export const legacyRedirects: MiddlewareHandler = async (c, next) => {
  const url = new URL(c.req.url);
  const target = legacyRedirectTarget(url.pathname, url.search);
  if (target) return c.redirect(target, 301);
  await next();
};
