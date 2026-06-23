import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier } from '@/resources/login';
import { describe, it, expect } from 'vitest';

// allowDomainDiscovery (settings-gated, default-off, both-branch).
//
// DECISION ENCODED HERE (mirrors the implementation comment): whether discovery
// runs is decided by the INSTANCE/BASE settings (`getLoginSettings(undefined)`),
// read BEFORE any org is known. The discovered org's settings then re-drive the
// rest of the ceremony. The fake exposes `setAllowDomainDiscovery(true)` to flip
// the base flag deterministically — the `settingsByOrg` map is NOT consulted for
// an empty/undefined orgId, so the base seam is the only reliable ON switch.

describe('resolveIdentifier — allowDomainDiscovery', () => {
  it('OFF (default): no domain lookup; unknown user → USER_NOT_FOUND', async () => {
    const p = new FakeAuthProvider({ orgDomains: { 'acme.test': 'org-acme' } });
    const r = await resolveIdentifier(p, [], {
      loginName: 'ghost@acme.test',
      emailDeliveryEnabled: true,
    });
    expect(r).toEqual({ ok: false, error: 'USER_NOT_FOUND' });
  });

  it('OFF (default): a real user with no explicit org resolves WITHOUT a domain lookup (byte-identical path)', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-acme' }],
      authMethods: { u1: ['password'] },
      orgDomains: { 'acme.test': 'org-acme' },
    });
    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      emailDeliveryEnabled: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe('/login/password');
    // No org was threaded — discovery is off, so the param is absent (today's behavior).
    expect(r.params.has('organization')).toBe(false);
  });

  it('ON: email domain resolves the org and the ceremony continues org-scoped', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-acme' }],
      authMethods: { u1: ['password'] },
      orgDomains: { 'acme.test': 'org-acme' },
      // org-scoped settings keep password on (drives the password screen)
      settingsByOrg: { 'org-acme': { allowPassword: true } },
    });
    p.setAllowDomainDiscovery(true); // base flag governs whether discovery runs
    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      emailDeliveryEnabled: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe('/login/password');
    expect(r.params.get('organization')).toBe('org-acme');
    // The persisted ceremony session is bound to the discovered org.
    expect(r.sessions.some((s) => s.organization === 'org-acme')).toBe(true);
  });

  it('ON but the domain maps to no org: falls through to today behavior (USER_NOT_FOUND)', async () => {
    const p = new FakeAuthProvider({ orgDomains: { 'acme.test': 'org-acme' } });
    p.setAllowDomainDiscovery(true);
    const r = await resolveIdentifier(p, [], {
      loginName: 'ghost@other.test',
      emailDeliveryEnabled: true,
    });
    expect(r).toEqual({ ok: false, error: 'USER_NOT_FOUND' });
  });

  it('ON but an explicit organization was supplied: discovery is skipped (explicit org wins)', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-explicit' }],
      authMethods: { u1: ['password'] },
      // acme.test maps to org-acme, but the caller already pinned org-explicit
      orgDomains: { 'acme.test': 'org-acme' },
      settingsByOrg: { 'org-explicit': { allowPassword: true } },
    });
    p.setAllowDomainDiscovery(true);
    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      organization: 'org-explicit',
      emailDeliveryEnabled: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The explicit org is preserved; discovery did NOT overwrite it with org-acme.
    expect(r.params.get('organization')).toBe('org-explicit');
  });

  it('ON but the loginName is not an email: no domain lookup (USER_NOT_FOUND)', async () => {
    const p = new FakeAuthProvider({ orgDomains: { 'acme.test': 'org-acme' } });
    p.setAllowDomainDiscovery(true);
    const r = await resolveIdentifier(p, [], { loginName: 'ghost', emailDeliveryEnabled: true });
    expect(r).toEqual({ ok: false, error: 'USER_NOT_FOUND' });
  });

  it('ON: a single auto-redirect IdP with password disallowed routes straight to that IdP intent', async () => {
    const p = new FakeAuthProvider({
      orgDomains: { 'corp.test': 'org-corp' },
      idps: [{ id: 'idp-okta', name: 'Okta', type: 'oidc' }],
      // org policy: password OFF, external IdP ON → single-IdP auto-redirect
      settingsByOrg: { 'org-corp': { allowPassword: false, allowExternalIdp: true } },
    });
    p.setAllowDomainDiscovery(true);
    const r = await resolveIdentifier(p, [], {
      loginName: 'someone@corp.test',
      emailDeliveryEnabled: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe('/sso');
    expect(r.params.get('idpId')).toBe('idp-okta');
    expect(r.params.get('organization')).toBe('org-corp');
  });
});
