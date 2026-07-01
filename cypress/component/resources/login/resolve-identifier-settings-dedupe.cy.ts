// cypress/component/resources/login/resolve-identifier-settings-dedupe.cy.ts
//
// Component (no-mount) port of resolve-identifier-settings-dedupe.test.ts.
// Uses cy.spy to count getLoginSettings calls (replaces vi.spyOn call-through).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier } from '@/resources/login';

describe('resolveIdentifier — getLoginSettings dedupe', () => {
  it('threaded but org is discovered (differs from caller org): inner settings are still re-read for the discovered org', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-acme' }],
      authMethods: { u1: ['password'] },
      orgDomains: { 'acme.test': 'org-acme' },
      settingsByOrg: { 'org-acme': { allowPassword: true } },
    });
    p.setAllowDomainDiscovery(true);
    // Caller threads BASE settings (no org) — but discovery resolves org-acme.
    const baseSettings = await p.getLoginSettings(undefined);
    const spy = cy.spy(p, 'getLoginSettings');

    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      emailDeliveryEnabled: true,
      settings: baseSettings,
    });

    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.params.get('organization')).to.equal('org-acme');
    // Discovery shifted org → the threaded (base) settings cannot be reused for org-acme;
    // the inner read for the discovered org still fires.
    const calledWithOrgAcme = spy.args.some((args: unknown[]) => args[0] === 'org-acme');
    expect(calledWithOrgAcme).to.equal(true);
  });
});
