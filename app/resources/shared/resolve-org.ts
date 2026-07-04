// app/resources/shared/resolve-org.ts
//
// Org-first, default-org fallback resolution for the login / authorize flows.
//
// Datum's OIDC requests do NOT carry the `urn:zitadel:iam:org:id:<id>` scope, and the rebuild
// resolved the login org ONLY from that scope — so `org` came back undefined, makeReqCtx(undefined)
// fell through to the INSTANCE/default context, and /login rendered the instance IdPs instead of the
// Datum Cloud org IdPs. This restores the old app's `getDefaultOrg()` fallback: prefer an explicit
// org (URL param / OIDC org-id scope), then an ops env pin, then the provider's instance Default
// Organization. The INSTANCE/default context (undefined) remains ONLY as the last resort, when the
// provider itself has no default org.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { env } from '@/server/infra/env.server';

// Per-serviceUrl memo of each Zitadel instance's Default Organization.
//
// Keyed by serviceUrl so multi-forward-host deployments (ZITADEL_TRUSTED_FORWARD_HOSTS) each
// get their own slot — a plain singleton would let the first-to-answer instance's org bleed
// into every subsequent request for any other instance (cross-tenant org bleed).
//
// Only NON-null results are cached; null is left uncached so the next call retries, preventing
// a transient miss from permanently pinning a request to the INSTANCE/default context.
//
// A `null` serviceUrl key (fake provider / unknown URL) keeps the old singleton behavior, which
// is fine because those deployments never span multiple distinct Zitadel instances.
const defaultOrgByUrl = new Map<string, string>();

/** Extract the serviceUrl from a provider instance when it exposes one, else null. */
function providerServiceUrl(provider: AuthProvider): string | null {
  return (provider as AuthProvider & { serviceUrl?: string }).serviceUrl ?? null;
}

/**
 * Memoized read of the provider's instance Default Organization, keyed by serviceUrl.
 * Only a NON-null id is cached; a null result is returned but left uncached so the next
 * call retries. The provider is injected (not module-global) to keep this unit-testable.
 */
export async function getCachedDefaultOrg(provider: AuthProvider): Promise<string | null> {
  const key = providerServiceUrl(provider) ?? '';
  const hit = defaultOrgByUrl.get(key);
  if (hit !== undefined) return hit;
  const resolved = await provider.getDefaultOrg();
  if (resolved !== null) defaultOrgByUrl.set(key, resolved);
  return resolved;
}

/** Test-only: clear the module cache so precedence/caching specs start from a clean slate. */
export function resetDefaultOrgCache(): void {
  defaultOrgByUrl.clear();
}

/**
 * Resolve the effective organization for a login/authorize flow — org-first, with a default-org
 * fallback:
 *   1. an explicit org (URL `?organization=` / OIDC org-id scope) always wins;
 *   2. else the `ZITADEL_DEFAULT_ORG_ID` env pin (ops override; no provider round-trip);
 *   3. else the provider's cached instance Default Organization;
 *   4. else `undefined` → INSTANCE/default context (last resort).
 */
export async function resolveOrg(
  provider: AuthProvider,
  urlOrg?: string
): Promise<string | undefined> {
  return urlOrg ?? env.ZITADEL_DEFAULT_ORG_ID ?? (await getCachedDefaultOrg(provider)) ?? undefined;
}
