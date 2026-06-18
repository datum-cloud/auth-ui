/**
 * Prefix a public/ asset path with Vite's base (`import.meta.env.BASE_URL`, = '/id/') so
 * the URL resolves behind the gateway, which only forwards /id/* to auth-ui. Root-absolute
 * paths (e.g. /images/...) 404 behind the gateway (they lack the /id prefix); on the local
 * dev server they happen to resolve, which masks the bug.
 */
export const assetUrl = (path: string): string =>
  `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
