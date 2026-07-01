// cypress/component/modules/auth/providers/fake/fake-provider.domain-discovery.cy.ts
//
// Component (no-mount) port of
// app/modules/auth/providers/fake/__tests__/fake-provider.domain-discovery.test.ts.
//
// NOTE: this exercises a FAKE provider (test double / harness), not production security logic.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

describe('FakeAuthProvider — findOrgByDomain', () => {
  it('resolves a seeded domain → orgId, and null for unknown domains or when none are seeded', async () => {
    const p = new FakeAuthProvider({ orgDomains: { 'acme.test': 'org-acme' } });
    expect(await p.findOrgByDomain('acme.test')).to.deep.equal({ orgId: 'org-acme' });
    expect(await p.findOrgByDomain('unknown.test')).to.be.null;
    expect(await new FakeAuthProvider().findOrgByDomain('acme.test')).to.be.null;
  });
});
