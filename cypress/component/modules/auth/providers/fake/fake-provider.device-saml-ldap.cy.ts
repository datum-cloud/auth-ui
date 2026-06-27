// cypress/component/modules/auth/providers/fake/fake-provider.device-saml-ldap.cy.ts
//
// Component (no-mount) port of
// app/modules/auth/providers/fake/__tests__/fake-provider.device-saml-ldap.test.ts.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

describe('FakeAuthProvider — device / saml / ldap (P6)', () => {
  it('resolves a seeded device auth request by user code, then authorizes it', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test' }],
      deviceAuths: [{ userCode: 'ABCD-EFGH', id: 'dev-1', appName: 'CLI', scope: ['openid'] }],
    });
    const req = await p.getDeviceAuth('ABCD-EFGH');
    expect(req).to.include({ id: 'dev-1', appName: 'CLI' });
    await p.authorizeDevice('dev-1', { session: { id: 's1', token: 't1' } });
    expect(p.isDeviceAuthorized('dev-1')).to.equal(true);
  });

  it('deny leaves the device unauthorized', async () => {
    const p = new FakeAuthProvider({ deviceAuths: [{ userCode: 'X', id: 'dev-2', scope: [] }] });
    await p.authorizeDevice('dev-2', {});
    expect(p.isDeviceAuthorized('dev-2')).to.equal(false);
  });

  it('authorizeDevice throws NOT_FOUND for unknown device auth id', async () => {
    const p = new FakeAuthProvider({});
    let err: { code?: string } | undefined;
    try {
      await p.authorizeDevice('nope', { session: { id: 's', token: 't' } });
    } catch (e) {
      err = e as { code?: string };
    }
    expect(err?.code).to.equal('NOT_FOUND');
  });

  it('getAuthRequest("saml") returns a seeded SAML request and createSamlResponse honors binding', async () => {
    const p = new FakeAuthProvider({
      samlRequests: [{ id: 'saml-1', clientId: 'sp', binding: 'post' }],
    });
    expect(await p.getAuthRequest('saml', 'saml-1')).to.include({ id: 'saml-1' });
    const r = await p.createSamlResponse('saml-1', { id: 's1', token: 't1' });
    expect(r.binding).to.equal('post');
    expect(r.relayState).to.be.a('string');
    expect(r.samlResponse).to.be.a('string');
  });

  it('createSamlResponse uses redirect binding when seeded with binding: redirect', async () => {
    const p = new FakeAuthProvider({
      samlRequests: [{ id: 'saml-2', clientId: 'sp', binding: 'redirect' }],
    });
    const r = await p.createSamlResponse('saml-2', { id: 's1', token: 't1' });
    expect(r.binding).to.equal('redirect');
    expect(r.url).to.include('SAMLResponse=');
    expect(r.relayState).to.be.undefined;
    expect(r.samlResponse).to.be.undefined;
  });

  it('startLdapIntent returns an intent for valid creds and throws on bad creds', async () => {
    const p = new FakeAuthProvider({
      ldapUsers: [{ username: 'bob', password: 'pw', userId: 'u2' }],
    });
    const intent = await p.startLdapIntent('idp-ldap', 'bob', 'pw');
    expect(intent.userId).to.equal('u2');
    expect(intent.idpIntentId).to.be.a('string');
    expect(intent.idpIntentToken).to.be.a('string');
    let err: { code?: string } | undefined;
    try {
      await p.startLdapIntent('idp-ldap', 'bob', 'wrong');
    } catch (e) {
      err = e as { code?: string };
    }
    expect(err?.code).to.equal('INVALID_CREDENTIALS');
  });

  it('startLdapIntent registers the intent so createSession can resolve it', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u13', loginName: 'ldap-bob@acme.test', displayName: 'LDAP Bob' }],
      ldapUsers: [{ username: 'bob', password: 'pw', userId: 'u13' }],
    });
    const { idpIntentId, idpIntentToken, userId } = await p.startLdapIntent(
      'idp-ldap',
      'bob',
      'pw'
    );
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
