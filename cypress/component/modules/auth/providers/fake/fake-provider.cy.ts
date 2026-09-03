// cypress/component/modules/auth/providers/fake/fake-provider.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/fake/__tests__/fake-provider.test.ts.
// FakeAuthProvider is pure in-memory logic (only imports @/modules/auth/types) → browser-safe.
//
// NOTE: this file exercises a FAKE provider (a test double used as the harness for the rest of
// the suite), not production security logic. Coverage here is deliberately consolidated to one
// representative test per distinct capability rather than one test per input permutation.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import type { User } from '@/modules/auth/types';
import { ProviderError } from '@/modules/auth/types';

// Phase B (D-FAKE, G6): register() must model Zitadel's duplicate-login-name rejection, or no
// Cypress test can reach the ALREADY_EXISTS branch the G7 enumeration suite exists to protect.
describe('FakeAuthProvider — duplicate-email register (G7 prerequisite)', () => {
  it('rejects a duplicate email with ALREADY_EXISTS', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u-1', loginName: 'taken@b.test' } as User] });
    try {
      await p.register({ email: 'taken@b.test', firstName: 'A', lastName: 'B' });
      expect.fail('expected ALREADY_EXISTS');
    } catch (e) {
      expect(e).to.be.instanceOf(ProviderError);
      expect((e as ProviderError).code).to.equal('ALREADY_EXISTS');
    }
  });

  it('is case-insensitive on the email comparison', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u-1', loginName: 'Taken@B.test' } as User] });
    try {
      await p.register({ email: 'taken@b.test', firstName: 'A', lastName: 'B' });
      expect.fail('expected ALREADY_EXISTS');
    } catch (e) {
      expect((e as ProviderError).code).to.equal('ALREADY_EXISTS');
    }
  });

  it('still registers a fresh address', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u-1', loginName: 'taken@b.test' } as User] });
    const u = await p.register({ email: 'fresh@b.test', firstName: 'A', lastName: 'B' });
    expect(u.loginName).to.equal('fresh@b.test');
  });
});

describe('FakeAuthProvider', () => {
  it('finds a seeded user by loginName, verifies the password factor only when a matching check is supplied, and tracks the designated admin session', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'alice@acme.test' }] });
    expect(await p.findUser('alice@acme.test')).to.include({ id: 'u1' });
    expect(await p.findUser('nobody@acme.test')).to.be.null;
    expect(await new FakeAuthProvider().findUser('alice@acme.test')).to.be.null;

    const verified = await p.createSession({ password: 'pw' });
    expect(verified.id).to.be.ok;
    expect(verified.factors.password?.verifiedAt).to.not.be.null;
    expect(await p.getSession(verified.id, verified.token)).to.include({ id: verified.id });
    expect(await p.getSession(verified.id, 'wrong-token')).to.be.null;

    const unverified = await new FakeAuthProvider().createSession({});
    expect(unverified.factors.password?.verifiedAt).to.be.null;

    p.setInstanceAdminSession('sess-admin');
    expect(await p.isInstanceAdmin({ id: 'sess-admin', token: 'tok-admin' })).to.equal(true);
    expect(await p.isInstanceAdmin({ id: 'sess-999', token: 'tok-nobody' })).to.equal(false);
  });
});

describe('FakeAuthProvider — Phase 1 surface', () => {
  const make = () =>
    new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test', displayName: 'Alice' }],
      passwords: { u1: 'hunter2' },
      authMethods: { u1: ['password'] },
      authRequests: { abc: { id: 'abc', scopes: ['openid'], prompt: [] } },
    });

  it('surfaces getLoginSettings base defaults and per-org / instance overrides for every configurable flag, and covers the user/session/auth-request lifecycle, including opts wiring, deletion, and the wrong-password error path', async () => {
    const base = await new FakeAuthProvider().getLoginSettings();
    expect(base.defaultRedirectUri).to.be.undefined;
    expect(base.hidePasswordReset).to.equal(false);
    expect(base.ignoreUnknownUsernames).to.equal(false);
    expect(base.allowDomainDiscovery).to.equal(false);
    expect(base.disableLoginWithEmail).to.equal(false);
    expect(base.disableLoginWithPhone).to.equal(false);

    const settingsProvider = new FakeAuthProvider({
      settingsByOrg: {
        'org-1': {
          hidePasswordReset: true,
          ignoreUnknownUsernames: true,
          allowDomainDiscovery: true,
          disableLoginWithEmail: true,
          disableLoginWithPhone: true,
        },
      },
    });
    settingsProvider.setLoginDefaultRedirectUri('http://localhost:3001');
    const overridden = await settingsProvider.getLoginSettings('org-1');
    expect(overridden.defaultRedirectUri).to.equal('http://localhost:3001');
    expect(overridden.hidePasswordReset).to.equal(true);
    expect(overridden.ignoreUnknownUsernames).to.equal(true);
    expect(overridden.allowDomainDiscovery).to.equal(true);
    expect(overridden.disableLoginWithEmail).to.equal(true);
    expect(overridden.disableLoginWithPhone).to.equal(true);

    // An unseeded org falls back to the base settings, unaffected by other orgs' overrides.
    expect((await settingsProvider.getLoginSettings('other-org')).allowDomainDiscovery).to.equal(
      false
    );

    const p = make();
    const u = await p.findUser('alice@acme.test');
    expect(u?.id).to.equal('u1');
    expect(await p.getUser('u1')).to.include({ id: 'u1' });
    expect(await p.listAuthMethods('u1')).to.deep.equal(['password']);

    const s = await p.createSession(
      {},
      { userId: 'u1', metadata: { 'maxmind/tracking-token': 'tok-abc' } }
    );
    expect(s.user?.id).to.equal('u1');
    expect(p.lastCreateSessionOpts?.userId).to.equal('u1');
    expect(p.lastCreateSessionOpts?.metadata).to.deep.equal({
      'maxmind/tracking-token': 'tok-abc',
    });

    const updated = await p.updateSession(s.id, s.token, { password: 'hunter2' });
    expect(updated.factors.password?.verifiedAt).to.not.be.null;
    expect(updated.user?.id).to.equal('u1');

    let err: { code?: string } | undefined;
    try {
      await p.updateSession(s.id, s.token, { password: 'nope' });
    } catch (e) {
      err = e as { code?: string };
    }
    expect(err?.code).to.equal('INVALID_CREDENTIALS');

    const req = await p.getAuthRequest('oidc', 'abc');
    expect(req.id).to.equal('abc');
    const { callbackUrl } = await p.createCallback('abc', { id: s.id, token: s.token });
    expect(callbackUrl).to.include('abc');

    await p.deleteSession(s.id, s.token);
    expect(await p.getSession(s.id, s.token)).to.be.null;
  });
});
