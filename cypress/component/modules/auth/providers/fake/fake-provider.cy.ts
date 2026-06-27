// cypress/component/modules/auth/providers/fake/fake-provider.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/fake/__tests__/fake-provider.test.ts.
// FakeAuthProvider is pure in-memory logic (only imports @/modules/auth/types) → browser-safe.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

describe('FakeAuthProvider', () => {
  it('finds a seeded user by loginName', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'alice@acme.test' }] });
    expect(await p.findUser('alice@acme.test')).to.include({ id: 'u1' });
    expect(await p.findUser('nobody@acme.test')).to.be.null;
    expect(await new FakeAuthProvider().findUser('alice@acme.test')).to.be.null;
  });

  it('creates a session with a verified password factor', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'alice@acme.test' }] });
    const s = await p.createSession({ password: 'pw' });
    expect(s.id).to.be.ok;
    expect(s.factors.password?.verifiedAt).to.not.be.null;
    expect(await p.getSession(s.id, s.token)).to.include({ id: s.id });
    expect(await p.getSession(s.id, 'wrong-token')).to.be.null;
    expect(await p.getSession('sess-999', s.token)).to.be.null;
  });

  it('leaves the password factor unverified when no password check is supplied', async () => {
    const p = new FakeAuthProvider();
    const s = await p.createSession({});
    expect(s.factors.password?.verifiedAt).to.be.null;
  });
});

describe('FakeAuthProvider — isInstanceAdmin', () => {
  it('returns true for the seeded instance-admin session', async () => {
    const p = new FakeAuthProvider();
    p.seedLiveSession({ id: 'sess-admin', token: 'tok-admin' });
    p.setInstanceAdminSession('sess-admin');
    expect(await p.isInstanceAdmin({ id: 'sess-admin', token: 'tok-admin' })).to.equal(true);
  });

  it('returns false for a regular (non-admin) session', async () => {
    const p = new FakeAuthProvider();
    p.seedLiveSession({ id: 'sess-user', token: 'tok-user' });
    expect(await p.isInstanceAdmin({ id: 'sess-user', token: 'tok-user' })).to.equal(false);
  });

  it('returns false when no admin session has been designated', async () => {
    const p = new FakeAuthProvider();
    expect(await p.isInstanceAdmin({ id: 'sess-nobody', token: 'tok-nobody' })).to.equal(false);
  });
});

describe('FakeAuthProvider — getLoginSettings defaultRedirectUri', () => {
  it('resolves undefined for defaultRedirectUri by default', async () => {
    const p = new FakeAuthProvider();
    const settings = await p.getLoginSettings();
    expect(settings.defaultRedirectUri).to.be.undefined;
  });

  it('returns the seeded defaultRedirectUri after setLoginDefaultRedirectUri', async () => {
    const p = new FakeAuthProvider();
    p.setLoginDefaultRedirectUri('http://localhost:3001');
    const settings = await p.getLoginSettings();
    expect(settings.defaultRedirectUri).to.equal('http://localhost:3001');
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
    expect(u?.id).to.equal('u1');
    expect(await p.getUser('u1')).to.include({ id: 'u1' });
    expect(await p.listAuthMethods('u1')).to.deep.equal(['password']);
  });

  it('createSession (user only) then updateSession with correct password verifies it', async () => {
    const p = make();
    const s = await p.createSession({}, { requestId: 'oidc_abc' });
    expect(s.factors.password?.verifiedAt ?? null).to.be.null;
    const updated = await p.updateSession(s.id, s.token, { password: 'hunter2' });
    expect(updated.factors.password?.verifiedAt).to.not.be.null;
  });

  it('createSession attaches the user named by opts.userId, and updateSession preserves it', async () => {
    const p = make();
    const s = await p.createSession({}, { userId: 'u1' });
    expect(s.user?.id).to.equal('u1');
    const updated = await p.updateSession(s.id, s.token, { password: 'hunter2' });
    expect(updated.user?.id).to.equal('u1');
  });

  it('createSession records opts.userId and opts.metadata for assertion', async () => {
    const p = make();
    await p.createSession({}, { userId: 'u1', metadata: { 'maxmind/tracking-token': 'tok-abc' } });
    expect(p.lastCreateSessionOpts?.userId).to.equal('u1');
    expect(p.lastCreateSessionOpts?.metadata).to.deep.equal({
      'maxmind/tracking-token': 'tok-abc',
    });
  });

  it('updateSession with wrong password throws ProviderError(INVALID_CREDENTIALS)', async () => {
    const p = make();
    const s = await p.createSession({});
    let err: { code?: string } | undefined;
    try {
      await p.updateSession(s.id, s.token, { password: 'nope' });
    } catch (e) {
      err = e as { code?: string };
    }
    expect(err?.code).to.equal('INVALID_CREDENTIALS');
  });

  it('getAuthRequest returns a seeded request and createCallback returns a callbackUrl', async () => {
    const p = new FakeAuthProvider({
      authRequests: { abc: { id: 'abc', scopes: ['openid'], prompt: [] } },
    });
    const req = await p.getAuthRequest('oidc', 'abc');
    expect(req.id).to.equal('abc');
    const s = await p.createSession({});
    const { callbackUrl } = await p.createCallback('abc', { id: s.id, token: s.token });
    expect(callbackUrl).to.include('abc');
  });

  it('deleteSession removes it', async () => {
    const p = make();
    const s = await p.createSession({});
    await p.deleteSession(s.id, s.token);
    expect(await p.getSession(s.id, s.token)).to.be.null;
  });
});

describe('FakeAuthProvider — getLoginSettings UX flags', () => {
  it('defaults hidePasswordReset and ignoreUnknownUsernames to false', async () => {
    const s = await new FakeAuthProvider().getLoginSettings();
    expect(s.hidePasswordReset).to.equal(false);
    expect(s.ignoreUnknownUsernames).to.equal(false);
  });
  it('honors per-org overrides for the UX flags', async () => {
    const p = new FakeAuthProvider({
      settingsByOrg: { 'org-1': { hidePasswordReset: true, ignoreUnknownUsernames: true } },
    });
    const s = await p.getLoginSettings('org-1');
    expect(s.hidePasswordReset).to.equal(true);
    expect(s.ignoreUnknownUsernames).to.equal(true);
  });
});

describe('FakeAuthProvider — getLoginSettings allowDomainDiscovery', () => {
  it('defaults to false and honors per-org override', async () => {
    expect((await new FakeAuthProvider().getLoginSettings()).allowDomainDiscovery).to.equal(false);
    const p = new FakeAuthProvider({ settingsByOrg: { o: { allowDomainDiscovery: true } } });
    expect((await p.getLoginSettings('o')).allowDomainDiscovery).to.equal(true);
  });
});

describe('FakeAuthProvider — getLoginSettings email/phone flags', () => {
  it('defaults disableLoginWithEmail and disableLoginWithPhone to false', async () => {
    const s = await new FakeAuthProvider().getLoginSettings();
    expect(s.disableLoginWithEmail).to.equal(false);
    expect(s.disableLoginWithPhone).to.equal(false);
  });
  it('honors per-org overrides', async () => {
    const p = new FakeAuthProvider({
      settingsByOrg: { 'org-1': { disableLoginWithEmail: true, disableLoginWithPhone: true } },
    });
    const s = await p.getLoginSettings('org-1');
    expect(s.disableLoginWithEmail).to.equal(true);
    expect(s.disableLoginWithPhone).to.equal(true);
  });
});
