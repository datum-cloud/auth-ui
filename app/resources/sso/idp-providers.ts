import type { AuthProvider } from '@/modules/auth/auth-provider';
import type { IdProvider } from '@/modules/auth/types';
import { resolveOrg } from '@/resources/shared/resolve-org';

// The active-IdP resolver, previously duplicated across sso.service.ts + 3 routes, in one place.
// Calls the EXISTING neutral port method (no new port surface) and reproduces the current
// guard verbatim from sso.service.ts:
//   const active = provider.capabilities.externalIdp
//     ? await provider.getActiveIdPs(organization)
//     : [];
//
// SINGLE CHOKE POINT for org-first / default-org fallback (extends the login/authorize fix to the
// SSO IdP-DISPLAY flows). `orgId` is the RAW org from the URL/payload; an explicit org always WINS,
// but an empty org (SSO-link entered with no `?organization=`) now falls back to the default org
// (env pin → provider instance Default Organization) instead of undefined → the INSTANCE/default
// IdPs (the wrong duplicates). Every display caller (sso-link/sso-action/sso-management) routes
// through here, so the fallback is applied in exactly one place.
export async function getActiveIdPs(provider: AuthProvider, orgId?: string): Promise<IdProvider[]> {
  const org = await resolveOrg(provider, orgId);
  return provider.capabilities.externalIdp ? provider.getActiveIdPs(org) : [];
}
