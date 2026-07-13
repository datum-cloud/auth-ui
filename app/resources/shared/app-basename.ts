/**
 * The basename the app is served under — MUST match `react-router.config.ts` (`basename: '/id/'`)
 * and `vite.config.ts` (`base: '/id/'`).
 *
 * Single source of truth for building ABSOLUTE links that must land on auth-ui rather than the
 * provider: email links (verify / password-reset / email-OTP) and IdP return URLs. The trusted
 * origin (PUBLIC_ORIGIN, supplied to those builders) is scheme+host ONLY and is shared with the
 * Zitadel API, so this basename MUST be prepended — otherwise the link resolves to the Zitadel
 * API (NOT_FOUND) instead of our route. React Router's basename auto-prefix does NOT apply to
 * these strings (they are provider-substituted templates / broker redirects, not RR navigations).
 */
export const APP_BASENAME = '/id';
