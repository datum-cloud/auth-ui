import { getActiveIdPs } from '../idp-providers';
import type { IdProvider } from '@/modules/auth/types';
import { describe, it, expect, vi } from 'vitest';

// Matches the REAL AuthProvider surface (confirmed from auth-provider.ts):
//   getActiveIdPs(orgId?: string): Promise<IdProvider[]>  // gated by capabilities.externalIdp
const sampleIdPs: IdProvider[] = [
  { id: 'idp-g', name: 'Google', type: 'GOOGLE' },
  { id: 'idp-gh', name: 'GitHub', type: 'GITHUB' },
];

function makeProvider(externalIdp: boolean) {
  return {
    capabilities: { externalIdp },
    getActiveIdPs: vi.fn(async (_orgId?: string) => sampleIdPs),
  } as unknown as Parameters<typeof getActiveIdPs>[0];
}

describe('getActiveIdPs', () => {
  it("returns the provider's active IdPs for the org when externalIdp is supported", async () => {
    const provider = makeProvider(true);
    const idps = await getActiveIdPs(provider, 'org-1');
    expect(idps.map((i) => i.id)).toEqual(['idp-g', 'idp-gh']);
    expect(provider.getActiveIdPs).toHaveBeenCalledWith('org-1');
  });

  it('returns [] without calling the port when externalIdp is unsupported', async () => {
    const provider = makeProvider(false);
    const idps = await getActiveIdPs(provider, 'org-1');
    expect(idps).toEqual([]);
    expect(provider.getActiveIdPs).not.toHaveBeenCalled();
  });
});
