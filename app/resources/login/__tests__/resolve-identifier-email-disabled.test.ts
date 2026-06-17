import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier } from '@/resources/login';
import { describe, it, expect } from 'vitest';

describe('resolveIdentifier — disableLoginWithEmail (detect-for-copy)', () => {
  it('OFF (default): email-shaped unknown identifier → USER_NOT_FOUND (unchanged)', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'alice' }] });
    const r = await resolveIdentifier(p, [], { loginName: 'ghost@acme.test' });
    expect(r).toEqual({ ok: false, error: 'USER_NOT_FOUND' });
  });

  it('ON + email-shaped + not found → EMAIL_LOGIN_DISABLED', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice' }],
      settingsByOrg: { 'org-x': { disableLoginWithEmail: true } },
    });
    const r = await resolveIdentifier(p, [], {
      loginName: 'ghost@acme.test',
      organization: 'org-x',
    });
    expect(r).toEqual({ ok: false, error: 'EMAIL_LOGIN_DISABLED' });
  });

  it('ON + non-email (plain username) + not found → USER_NOT_FOUND', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice' }],
      settingsByOrg: { 'org-x': { disableLoginWithEmail: true } },
    });
    const r = await resolveIdentifier(p, [], { loginName: 'bob', organization: 'org-x' });
    expect(r).toEqual({ ok: false, error: 'USER_NOT_FOUND' });
  });

  it('ON + ignoreUnknownUsernames ON: no email-disabled — funnels to password (reveals nothing)', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice' }],
      settingsByOrg: { 'org-x': { disableLoginWithEmail: true, ignoreUnknownUsernames: true } },
    });
    const r = await resolveIdentifier(p, [], {
      loginName: 'ghost@acme.test',
      organization: 'org-x',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe('/login/password');
  });
});
