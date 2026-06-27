// cypress/component/resources/login/resolve-identifier-ignore-unknown.cy.ts
//
// Component (no-mount) port of resolve-identifier-ignore-unknown.test.ts.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier } from '@/resources/login';

describe('resolveIdentifier — ignoreUnknownUsernames', () => {
  it('OFF (default): unknown identifier returns USER_NOT_FOUND (unchanged)', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'alice@acme.test' }] });
    const r = await resolveIdentifier(p, [], {
      loginName: 'ghost@acme.test',
      emailDeliveryEnabled: true,
    });
    expect(r).to.deep.equal({ ok: false, error: 'USER_NOT_FOUND' });
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
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.target).to.equal('/login/password');
    expect(r.params.get('loginName')).to.equal('ghost@acme.test');
    expect(r.params.get('organization')).to.equal('org-x');
    expect(
      r.sessions.some((s: { loginName: string }) => s.loginName === 'ghost@acme.test')
    ).to.equal(true);
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
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.target).to.equal('/login/password');
  });
});
