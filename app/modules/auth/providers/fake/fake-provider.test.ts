import { FakeAuthProvider } from './fake-provider';
import { describe, it, expect } from 'vitest';

describe('FakeAuthProvider', () => {
  it('finds a seeded user by loginName', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'alice@acme.test' }] });
    expect(await p.findUser('alice@acme.test')).toMatchObject({ id: 'u1' });
    expect(await p.findUser('nobody@acme.test')).toBeNull();
    expect(await new FakeAuthProvider().findUser('alice@acme.test')).toBeNull();
  });

  it('creates a session with a verified password factor', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'alice@acme.test' }] });
    const s = await p.createSession({ password: 'pw' });
    expect(s.id).toBeTruthy();
    expect(s.factors.password?.verifiedAt).not.toBeNull();
    expect(await p.getSession(s.id, s.token)).toMatchObject({ id: s.id });
    expect(await p.getSession(s.id, 'wrong-token')).toBeNull();
    expect(await p.getSession('sess-999', s.token)).toBeNull();
  });

  it('leaves the password factor unverified when no password check is supplied', async () => {
    const p = new FakeAuthProvider();
    const s = await p.createSession({});
    expect(s.factors.password?.verifiedAt).toBeNull();
  });
});

describe('FakeAuthProvider — isInstanceAdmin', () => {
  it('returns true for the seeded instance-admin session', async () => {
    const p = new FakeAuthProvider();
    // seed a live session that is designated as the instance admin
    p.seedLiveSession({ id: 'sess-admin', token: 'tok-admin' });
    p.setInstanceAdminSession('sess-admin');
    expect(await p.isInstanceAdmin({ id: 'sess-admin', token: 'tok-admin' })).toBe(true);
  });

  it('returns false for a regular (non-admin) session', async () => {
    const p = new FakeAuthProvider();
    p.seedLiveSession({ id: 'sess-user', token: 'tok-user' });
    expect(await p.isInstanceAdmin({ id: 'sess-user', token: 'tok-user' })).toBe(false);
  });

  it('returns false when no admin session has been designated', async () => {
    const p = new FakeAuthProvider();
    expect(await p.isInstanceAdmin({ id: 'sess-nobody', token: 'tok-nobody' })).toBe(false);
  });
});

describe('FakeAuthProvider — getLoginSettings defaultRedirectUri', () => {
  it('resolves undefined for defaultRedirectUri by default', async () => {
    const p = new FakeAuthProvider();
    const settings = await p.getLoginSettings();
    expect(settings.defaultRedirectUri).toBeUndefined();
  });

  it('returns the seeded defaultRedirectUri after setLoginDefaultRedirectUri', async () => {
    const p = new FakeAuthProvider();
    p.setLoginDefaultRedirectUri('http://localhost:3001');
    const settings = await p.getLoginSettings();
    expect(settings.defaultRedirectUri).toBe('http://localhost:3001');
  });
});

describe('FakeAuthProvider — Phase 1 surface', () => {
  const make = () =>
    new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', displayName: 'Alice' }],
      passwords: { u1: 'hunter2' },
      authMethods: { u1: ['password'] },
    });

  it('findUser + getUser + listAuthMethods', async () => {
    const p = make();
    const u = await p.findUser('alice@acme.test');
    expect(u?.id).toBe('u1');
    expect(await p.getUser('u1')).toMatchObject({ id: 'u1' });
    expect(await p.listAuthMethods('u1')).toEqual(['password']);
  });

  it('createSession (user only) then updateSession with correct password verifies it', async () => {
    const p = make();
    const s = await p.createSession({}, { requestId: 'oidc_abc' });
    expect(s.factors.password?.verifiedAt ?? null).toBeNull();
    const updated = await p.updateSession(s.id, s.token, { password: 'hunter2' });
    expect(updated.factors.password?.verifiedAt).not.toBeNull();
  });

  it('createSession attaches the user named by opts.userId, and updateSession preserves it', async () => {
    const p = make();
    const s = await p.createSession({}, { userId: 'u1' });
    expect(s.user?.id).toBe('u1');
    const updated = await p.updateSession(s.id, s.token, { password: 'hunter2' });
    expect(updated.user?.id).toBe('u1');
  });

  it('createSession records opts.userId and opts.metadata for assertion', async () => {
    const p = make();
    await p.createSession({}, { userId: 'u1', metadata: { 'maxmind/tracking-token': 'tok-abc' } });
    expect(p.lastCreateSessionOpts?.userId).toBe('u1');
    expect(p.lastCreateSessionOpts?.metadata).toEqual({ 'maxmind/tracking-token': 'tok-abc' });
  });

  it('updateSession with wrong password throws ProviderError(INVALID_CREDENTIALS)', async () => {
    const p = make();
    const s = await p.createSession({});
    await expect(p.updateSession(s.id, s.token, { password: 'nope' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('getAuthRequest returns a seeded request and createCallback returns a callbackUrl', async () => {
    const p = new FakeAuthProvider({
      authRequests: { abc: { id: 'abc', scopes: ['openid'], prompt: [] } },
    });
    const req = await p.getAuthRequest('oidc', 'abc');
    expect(req.id).toBe('abc');
    const s = await p.createSession({});
    const { callbackUrl } = await p.createCallback('abc', { id: s.id, token: s.token });
    expect(callbackUrl).toContain('abc');
  });

  it('deleteSession removes it', async () => {
    const p = make();
    const s = await p.createSession({});
    await p.deleteSession(s.id, s.token);
    expect(await p.getSession(s.id, s.token)).toBeNull();
  });
});

describe('FakeAuthProvider — getLoginSettings UX flags', () => {
  it('defaults hidePasswordReset and ignoreUnknownUsernames to false', async () => {
    const s = await new FakeAuthProvider().getLoginSettings();
    expect(s.hidePasswordReset).toBe(false);
    expect(s.ignoreUnknownUsernames).toBe(false);
  });
  it('honors per-org overrides for the UX flags', async () => {
    const p = new FakeAuthProvider({
      settingsByOrg: { 'org-1': { hidePasswordReset: true, ignoreUnknownUsernames: true } },
    });
    const s = await p.getLoginSettings('org-1');
    expect(s.hidePasswordReset).toBe(true);
    expect(s.ignoreUnknownUsernames).toBe(true);
  });
});

describe('FakeAuthProvider — getLoginSettings allowDomainDiscovery', () => {
  it('defaults to false and honors per-org override', async () => {
    expect((await new FakeAuthProvider().getLoginSettings()).allowDomainDiscovery).toBe(false);
    const p = new FakeAuthProvider({ settingsByOrg: { o: { allowDomainDiscovery: true } } });
    expect((await p.getLoginSettings('o')).allowDomainDiscovery).toBe(true);
  });
});

describe('FakeAuthProvider — getLoginSettings email/phone flags', () => {
  it('defaults disableLoginWithEmail and disableLoginWithPhone to false', async () => {
    const s = await new FakeAuthProvider().getLoginSettings();
    expect(s.disableLoginWithEmail).toBe(false);
    expect(s.disableLoginWithPhone).toBe(false);
  });
  it('honors per-org overrides', async () => {
    const p = new FakeAuthProvider({
      settingsByOrg: { 'org-1': { disableLoginWithEmail: true, disableLoginWithPhone: true } },
    });
    const s = await p.getLoginSettings('org-1');
    expect(s.disableLoginWithEmail).toBe(true);
    expect(s.disableLoginWithPhone).toBe(true);
  });
});
