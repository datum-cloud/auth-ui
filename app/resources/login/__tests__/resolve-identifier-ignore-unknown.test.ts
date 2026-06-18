import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier } from '@/resources/login';
import { describe, it, expect } from 'vitest';

describe('resolveIdentifier — ignoreUnknownUsernames', () => {
  it('OFF (default): unknown identifier returns USER_NOT_FOUND (unchanged)', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'alice@acme.test' }] });
    const r = await resolveIdentifier(p, [], {
      loginName: 'ghost@acme.test',
      emailDeliveryEnabled: true,
    });
    expect(r).toEqual({ ok: false, error: 'USER_NOT_FOUND' });
  });

  it('ON: unknown identifier proceeds to /login/password with the typed name + a ceremony session', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test' }],
      settingsByOrg: { 'org-x': { ignoreUnknownUsernames: true } },
    });
    const r = await resolveIdentifier(p, [], {
      loginName: 'ghost@acme.test',
      organization: 'org-x',
      emailDeliveryEnabled: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe('/login/password');
    expect(r.params.get('loginName')).toBe('ghost@acme.test');
    expect(r.params.get('organization')).toBe('org-x');
    expect(r.sessions.some((s) => s.loginName === 'ghost@acme.test')).toBe(true);
  });

  it('ON but the user EXISTS: behaves exactly like the normal known-user path', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test' }],
      authMethods: { u1: ['password'] },
      settingsByOrg: { 'org-x': { ignoreUnknownUsernames: true } },
    });
    const r = await resolveIdentifier(p, [], {
      loginName: 'alice@acme.test',
      organization: 'org-x',
      emailDeliveryEnabled: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe('/login/password');
  });
});
