// cypress/component/modules/auth/providers/fake/fake-provider.device-saml-ldap.cy.ts
//
// Component (no-mount) port of
// app/modules/auth/providers/fake/__tests__/fake-provider.device-saml-ldap.test.ts.
//
// NOTE: this exercises a FAKE provider (test double / harness), not production security logic.
// One representative test per protocol (device / saml / ldap).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

describe('FakeAuthProvider — device / saml / ldap (P6)', () => {
  it('resolves a seeded device auth request by user code, authorizes/denies it, and returns seeded SAML requests with post/redirect response bindings', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test' }],
      deviceAuths: [{ userCode: 'ABCD-EFGH', id: 'dev-1', appName: 'CLI', scope: ['openid'] }],
    });
    const req = await p.getDeviceAuth('ABCD-EFGH');
    expect(req).to.include({ id: 'dev-1', appName: 'CLI' });
    await p.authorizeDevice('dev-1', { session: { id: 's1', token: 't1' } });
    expect(p.isDeviceAuthorized('dev-1')).to.equal(true);

    const p2 = new FakeAuthProvider({ deviceAuths: [{ userCode: 'X', id: 'dev-2', scope: [] }] });
    await p2.authorizeDevice('dev-2', {});
    expect(p2.isDeviceAuthorized('dev-2')).to.equal(false);

    const p3 = new FakeAuthProvider({
      samlRequests: [
        { id: 'saml-1', clientId: 'sp', binding: 'post' },
        { id: 'saml-2', clientId: 'sp', binding: 'redirect' },
      ],
    });
    expect(await p3.getAuthRequest('saml', 'saml-1')).to.include({ id: 'saml-1' });

    const post = await p3.createSamlResponse('saml-1', { id: 's1', token: 't1' });
    expect(post.binding).to.equal('post');
    expect(post.relayState).to.be.a('string');
    expect(post.samlResponse).to.be.a('string');

    const redirect = await p3.createSamlResponse('saml-2', { id: 's1', token: 't1' });
    expect(redirect.binding).to.equal('redirect');
    expect(redirect.url).to.include('SAMLResponse=');
    expect(redirect.relayState).to.be.undefined;
    expect(redirect.samlResponse).to.be.undefined;
  });

  it('startLdapIntent validates credentials, and the resulting intent resolves through createSession', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u13', loginName: 'ldap-bob@acme.test', displayName: 'LDAP Bob' }],
      ldapUsers: [{ username: 'bob', password: 'pw', userId: 'u13' }],
    });
    const { idpIntentId, idpIntentToken, userId } = await p.startLdapIntent(
      'idp-ldap',
      'bob',
      'pw'
    );
    expect(userId).to.equal('u13');

    let err: { code?: string } | undefined;
    try {
      await p.startLdapIntent('idp-ldap', 'bob', 'wrong');
    } catch (e) {
      err = e as { code?: string };
    }
    expect(err?.code).to.equal('INVALID_CREDENTIALS');

    const session = await p.createSession(
      { idpIntent: { idpIntentId, idpIntentToken } },
      { userId }
    );
    expect(session.user?.id).to.equal('u13');
    expect(session.user?.loginName).to.equal('ldap-bob@acme.test');
    expect(session.id).to.match(/^sess-/);
    expect(session.factors.idpIntent?.verifiedAt).to.be.ok;
  });
});
