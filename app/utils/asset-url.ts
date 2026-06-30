/**
 * Prefix a public/ asset path with Vite's base (`import.meta.env.BASE_URL`, = '/id/') so
 * the URL resolves behind the gateway, which only forwards /id/* to auth-ui. Root-absolute
 * paths (e.g. /images/...) 404 behind the gateway (they lack the /id prefix); on the local
 * dev server they happen to resolve, which masks the bug.
 */
export const assetUrl = (path: string): string =>
  `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;

/**
 * Resolve the dark-theme variant of a public asset using the `.dark` suffix convention:
 * `/images/x.svg` → `<base>/images/x.dark.svg`. Pair with `<ThemedImage dark={...}>`.
 * Leaves the path unchanged (aside from the base prefix) when it has no file extension.
 */
export const darkAssetUrl = (path: string): string =>
  assetUrl(path.replace(/(\.[^./]+)$/, '.dark$1'));
