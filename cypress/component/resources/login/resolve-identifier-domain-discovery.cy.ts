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

  it('OFF (default): a real user with no explicit org resolves WITHOUT a domain lookup', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-acme' }],
      authMethods: { u1: ['password'] },
      orgDomains: { 'acme.test': 'org-acme' },
    });
    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      emailDeliveryEnabled: true,
    });
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.target).to.equal('/login/password');
    // No org was threaded — discovery is off, so the param is absent.
    expect(r.params.has('organization')).to.equal(false);
  });

  it('ON: email domain resolves the org and the ceremony continues org-scoped', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-acme' }],
      authMethods: { u1: ['password'] },
      orgDomains: { 'acme.test': 'org-acme' },
      settingsByOrg: { 'org-acme': { allowPassword: true } },
    });
    p.setAllowDomainDiscovery(true);
    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      emailDeliveryEnabled: true,
    });
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.target).to.equal('/login/password');
    expect(r.params.get('organization')).to.equal('org-acme');
    expect(
      r.sessions.some((s: { organization?: string }) => s.organization === 'org-acme')
    ).to.equal(true);
  });

  it('ON but the domain maps to no org: falls through to today behavior (USER_NOT_FOUND)', async () => {
    const p = new FakeAuthProvider({ orgDomains: { 'acme.test': 'org-acme' } });
    p.setAllowDomainDiscovery(true);
    const r = await resolveIdentifier(p, [], {
      loginName: 'ghost@other.test',
      emailDeliveryEnabled: true,
    });
    expect(r).to.deep.equal({ ok: false, error: 'USER_NOT_FOUND' });
  });

  it('ON but an explicit organization was supplied: discovery is skipped (explicit org wins)', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-explicit' }],
      authMethods: { u1: ['password'] },
      orgDomains: { 'acme.test': 'org-acme' },
      settingsByOrg: { 'org-explicit': { allowPassword: true } },
    });
    p.setAllowDomainDiscovery(true);
    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      organization: 'org-explicit',
      emailDeliveryEnabled: true,
    });
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    // The explicit org is preserved; discovery did NOT overwrite it with org-acme.
    expect(r.params.get('organization')).to.equal('org-explicit');
  });

  it('ON but the loginName is not an email: no domain lookup (USER_NOT_FOUND)', async () => {
    const p = new FakeAuthProvider({ orgDomains: { 'acme.test': 'org-acme' } });
    p.setAllowDomainDiscovery(true);
    const r = await resolveIdentifier(p, [], { loginName: 'ghost', emailDeliveryEnabled: true });
    expect(r).to.deep.equal({ ok: false, error: 'USER_NOT_FOUND' });
  });

  it('ON: a single auto-redirect IdP with password disallowed routes straight to that IdP intent', async () => {
    const p = new FakeAuthProvider({
      orgDomains: { 'corp.test': 'org-corp' },
      idps: [{ id: 'idp-okta', name: 'Okta', type: 'oidc' }],
      settingsByOrg: { 'org-corp': { allowPassword: false, allowExternalIdp: true } },
    });
    p.setAllowDomainDiscovery(true);
    const r = await resolveIdentifier(p, [], {
      loginName: 'someone@corp.test',
      emailDeliveryEnabled: true,
    });
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.target).to.equal('/sso');
    expect(r.params.get('idpId')).to.equal('idp-okta');
    expect(r.params.get('organization')).to.equal('org-corp');
  });
});
