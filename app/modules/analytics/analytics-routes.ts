// app/modules/analytics/analytics-routes.ts
//
// Which pages may load the third-party Rybbit script. The script is unversioned, so SRI cannot
// pin it, and it runs with the CSP nonce ('strict-dynamic' trust). On a page with a password,
// OTP or passkey form it could read those fields if app.rybbit.io were ever compromised. So it
// loads only on terminal pages that hold no credential input or ceremony: the "you're done"
// screens, which are also where the client-side auth conversion events fire.
//
// /signup/success is deliberately absent: it auto-starts a passkey sign-in ceremony and its URL
// always carries ?loginName=<email>.
import { APP_BASENAME } from '@/resources/shared/app-basename';

/** App-relative paths (as in app/routes.ts) of the pages allowed to load analytics. */
export const ANALYTICS_ROUTES: readonly string[] = [
  '/signed-in',
  '/logout/success',
  '/verify/success',
];

/**
 * Query parameters that carry the account email. Rybbit records the query string with every
 * pageview and event, so a page whose URL holds one of these never loads the script.
 */
export const PII_QUERY_PARAMS: readonly string[] = ['loginName', 'email'];

/**
 * True when `pathname` is one of ANALYTICS_ROUTES and `search` (if given) carries none of
 * PII_QUERY_PARAMS. Accepts either the full served path (`/id/signed-in`) or the app-relative
 * path React Router's useLocation returns under the basename (`/signed-in`). A trailing slash
 * is ignored; anything else must match exactly.
 */
export function isAnalyticsRoute(pathname: string, search = ''): boolean {
  const relative =
    pathname === APP_BASENAME || pathname.startsWith(`${APP_BASENAME}/`)
      ? pathname.slice(APP_BASENAME.length)
      : pathname;
  const normalized = relative.length > 1 ? relative.replace(/\/+$/, '') : relative;
  if (!ANALYTICS_ROUTES.includes(normalized)) return false;
  const params = new URLSearchParams(search);
  return !PII_QUERY_PARAMS.some((name) => params.has(name));
}

/**
 * Rybbit `data-skip-patterns` value: one regex that matches every served pathname EXCEPT the
 * allowlisted ones. Once loaded, the script stays in memory and auto-tracks client-side
 * navigations; this makes it drop pageviews and events on any page the gate would not load it
 * on (e.g. /signed-in → "Not you?" → /login/password?loginName=…).
 */
export function rybbitSkipPatterns(): string {
  const escaped = ANALYTICS_ROUTES.map((route) =>
    `${APP_BASENAME}${route}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  return JSON.stringify([`re:^(?!(?:${escaped.join('|')})/?$)`]);
}
