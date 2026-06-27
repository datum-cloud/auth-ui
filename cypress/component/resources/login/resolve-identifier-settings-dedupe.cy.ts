// cypress/component/resources/login/resolve-identifier-settings-dedupe.cy.ts
//
// Component (no-mount) port of resolve-identifier-settings-dedupe.test.ts.
// Uses cy.spy to count getLoginSettings calls (replaces vi.spyOn call-through).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier } from '@/resources/login';

describe('resolveIdentifier — getLoginSettings dedupe', () => {
  it('NOT threaded (default): known-user happy path fetches settings inside (unchanged)', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-acme' }],
      authMethods: { u1: ['password'] },
    });
    const spy = cy.spy(p, 'getLoginSettings');

    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      organization: 'org-acme',
      emailDeliveryEnabled: true,
    });

    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.target).to.equal('/login/password');
    // Pinned org → no domain-discovery base read; exactly one settings fetch (the inner one).
    expect(spy.callCount).to.equal(1);
    expect(spy.args[0][0]).to.equal('org-acme');
  });

  it('threaded: known-user happy path does NOT re-fetch settings (one fewer call), identical result', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-acme' }],
      authMethods: { u1: ['password'] },
    });
    const settings = await p.getLoginSettings('org-acme');
    const spy = cy.spy(p, 'getLoginSettings');

    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      organization: 'org-acme',
      emailDeliveryEnabled: true,
      settings,
    });

    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.target).to.equal('/login/password');
    // The threaded settings replace the inner fetch — zero calls from this point.
    expect(spy.callCount).to.equal(0);

    // Result parity with the non-threaded path.
    const baseline = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      organization: 'org-acme',
      emailDeliveryEnabled: true,
    });
    expect(baseline.ok).to.equal(true);
    if (!baseline.ok) return;
    expect(r.target).to.equal(baseline.target);
    expect([...r.params.entries()]).to.deep.equal([...baseline.params.entries()]);
  });

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
