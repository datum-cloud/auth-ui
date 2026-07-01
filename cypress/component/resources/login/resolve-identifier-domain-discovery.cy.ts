// cypress/component/resources/login/resolve-identifier-domain-discovery.cy.ts
//
// Component (no-mount) port of resolve-identifier-domain-discovery.test.ts.
// allowDomainDiscovery (settings-gated, default-off, both-branch).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier } from '@/resources/login';

describe('resolveIdentifier — allowDomainDiscovery', () => {
  it('OFF (default): no domain lookup; unknown user → USER_NOT_FOUND', async () => {
    const p = new FakeAuthProvider({ orgDomains: { 'acme.test': 'org-acme' } });
    const r = await resolveIdentifier(p, [], {
      loginName: 'ghost@acme.test',
      emailDeliveryEnabled: true,
    });
    expect(r).to.deep.equal({ ok: false, error: 'USER_NOT_FOUND' });
  });
});
