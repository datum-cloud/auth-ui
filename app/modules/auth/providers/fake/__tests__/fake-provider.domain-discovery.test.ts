import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { describe, it, expect } from 'vitest';

describe('FakeAuthProvider — findOrgByDomain', () => {
  it('resolves a seeded domain → orgId, and null otherwise', async () => {
    const p = new FakeAuthProvider({ orgDomains: { 'acme.test': 'org-acme' } });
    expect(await p.findOrgByDomain('acme.test')).toEqual({ orgId: 'org-acme' });
    expect(await p.findOrgByDomain('unknown.test')).toBeNull();
  });

  it('returns null when no domains are seeded', async () => {
    const p = new FakeAuthProvider();
    expect(await p.findOrgByDomain('acme.test')).toBeNull();
  });
});
