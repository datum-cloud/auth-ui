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

// Module-level memo of the provider's instance Default Organization. It is STABLE for the life of
// the process, so one lookup serves every request. A `null` result (provider returned no default)
// is deliberately NOT cached — the next call retries, so a transient miss never pins us to the
// instance/default context permanently.
let cachedDefaultOrg: string | null = null;

/**
 * Memoized read of the provider's instance Default Organization. Only a NON-null id is cached; a
 * null result is returned but left uncached so the next call retries. The provider is injected
 * (not module-global) to keep this unit-testable.
 */
export async function getCachedDefaultOrg(provider: AuthProvider): Promise<string | null> {
  if (cachedDefaultOrg !== null) return cachedDefaultOrg;
  const resolved = await provider.getDefaultOrg();
  if (resolved !== null) cachedDefaultOrg = resolved;
  return resolved;
}

/** Test-only: clear the module cache so precedence/caching specs start from a clean slate. */
export function resetDefaultOrgCache(): void {
  cachedDefaultOrg = null;
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
