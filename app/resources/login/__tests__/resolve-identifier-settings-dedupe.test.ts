import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier } from '@/resources/login';
import { describe, it, expect, vi } from 'vitest';

// Dedupe getLoginSettings.
//
// The /login route action already fetches `getLoginSettings(organization)` (for the
// phone-rejection gate) BEFORE it calls resolveIdentifier. On the known-user happy
// path resolveIdentifier then fetched the SAME settings again (a second RPC for the
// identical org). Threading the already-fetched settings in as an optional param
// lets resolveIdentifier skip that inner re-fetch — fewer calls, identical result.
//
// Backward-compatible: the param is optional; existing callers (none threaded) keep
// the prior behavior byte-for-byte. Both branches are asserted below.

describe('resolveIdentifier — getLoginSettings dedupe', () => {
  it('NOT threaded (default): known-user happy path fetches settings inside (unchanged)', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-acme' }],
      authMethods: { u1: ['password'] },
    });
    const spy = vi.spyOn(p, 'getLoginSettings');

    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      organization: 'org-acme',
      emailDeliveryEnabled: true,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe('/login/password');
    // Pinned org → no domain-discovery base read; exactly one settings fetch (the inner one).
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('org-acme');
  });

  it('threaded: known-user happy path does NOT re-fetch settings (one fewer call), identical result', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-acme' }],
      authMethods: { u1: ['password'] },
    });
    const settings = await p.getLoginSettings('org-acme');
    const spy = vi.spyOn(p, 'getLoginSettings');

    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      organization: 'org-acme',
      emailDeliveryEnabled: true,
      settings,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe('/login/password');
    // The threaded settings (for org-acme === the caller's org) replace the inner fetch.
    expect(spy).not.toHaveBeenCalled();

    // Result parity with the non-threaded path.
    const baseline = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      organization: 'org-acme',
      emailDeliveryEnabled: true,
    });
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    expect(r.target).toBe(baseline.target);
    expect([...r.params.entries()]).toEqual([...baseline.params.entries()]);
  });

  it('threaded but org is discovered (differs from caller org): inner settings are still re-read for the discovered org', async () => {
    // When domain-discovery shifts `org` away from the caller's `organization`, the
    // threaded settings (which describe the caller's org) no longer apply — the inner
    // read must run for the discovered org. Here: no caller org, discovery resolves one.
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', orgId: 'org-acme' }],
      authMethods: { u1: ['password'] },
      orgDomains: { 'acme.test': 'org-acme' },
      settingsByOrg: { 'org-acme': { allowPassword: true } },
    });
    p.setAllowDomainDiscovery(true);
    // Caller threads BASE settings (no org) — but discovery resolves org-acme.
    const baseSettings = await p.getLoginSettings(undefined);
    const spy = vi.spyOn(p, 'getLoginSettings');

    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      emailDeliveryEnabled: true,
      settings: baseSettings,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.get('organization')).toBe('org-acme');
    // Discovery shifted org → the threaded (base) settings cannot be reused for org-acme;
    // the inner read for the discovered org still fires.
    expect(spy).toHaveBeenCalledWith('org-acme');
  });
});
