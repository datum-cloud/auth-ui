import type { AuthProvider } from '@/modules/auth/auth-provider';
import type { IdProvider } from '@/modules/auth/types';

// The active-IdP resolver, previously duplicated across sso.service.ts + 3 routes, in one place.
// Calls the EXISTING neutral port method (no new port surface) and reproduces the current
// guard verbatim from sso.service.ts:
//   const active = provider.capabilities.externalIdp
//     ? await provider.getActiveIdPs(organization)
//     : [];
// Additive.
export async function getActiveIdPs(provider: AuthProvider, orgId?: string): Promise<IdProvider[]> {
  return provider.capabilities.externalIdp ? provider.getActiveIdPs(orgId) : [];
}
