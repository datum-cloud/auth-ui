// app/modules/analytics/analytics-routes.ts
//
// Which pages may load the third-party Rybbit script. The script is unversioned, so SRI cannot
// pin it, and it runs with the CSP nonce ('strict-dynamic' trust). On a page with a password,
// OTP or passkey form it could read those fields if app.rybbit.io were ever compromised. So it
// loads only on terminal pages that hold no credential input: the "you're done" screens, which
// are also the only places the auth conversion events fire.
import { APP_BASENAME } from '@/resources/shared/app-basename';

/** App-relative paths (as in app/routes.ts) of the pages allowed to load analytics. */
export const ANALYTICS_ROUTES: readonly string[] = [
  '/signed-in',
  '/logout/success',
  '/signup/success',
  '/verify/success',
];

/**
 * True when `pathname` is one of ANALYTICS_ROUTES. Accepts either the full served path
 * (`/id/signed-in`) or the app-relative path React Router's useLocation returns under the
 * basename (`/signed-in`). A trailing slash is ignored; anything else must match exactly.
 */
export function isAnalyticsRoute(pathname: string): boolean {
  const relative =
    pathname === APP_BASENAME || pathname.startsWith(`${APP_BASENAME}/`)
      ? pathname.slice(APP_BASENAME.length)
      : pathname;
  const normalized = relative.length > 1 ? relative.replace(/\/+$/, '') : relative;
  return ANALYTICS_ROUTES.includes(normalized);
}
