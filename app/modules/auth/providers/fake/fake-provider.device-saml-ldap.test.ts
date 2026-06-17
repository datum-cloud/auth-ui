import { FakeAuthProvider } from './fake-provider';
import { describe, it, expect } from 'vitest';

describe('FakeAuthProvider — device / saml / ldap (P6)', () => {
  it('resolves a seeded device auth request by user code, then authorizes it', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@acme.test' }],
      deviceAuths: [{ userCode: 'ABCD-EFGH', id: 'dev-1', appName: 'CLI', scope: ['openid'] }],
    });
    const req = await p.getDeviceAuth('ABCD-EFGH');
    expect(req).toMatchObject({ id: 'dev-1', appName: 'CLI' });
    await p.authorizeDevice('dev-1', { session: { id: 's1', token: 't1' } });
    expect(p.isDeviceAuthorized('dev-1')).toBe(true);
  });

  it('deny leaves the device unauthorized', async () => {
    const p = new FakeAuthProvider({ deviceAuths: [{ userCode: 'X', id: 'dev-2', scope: [] }] });
    // no session → implicit denial
    await p.authorizeDevice('dev-2', {});
    expect(p.isDeviceAuthorized('dev-2')).toBe(false);
  });

  it('authorizeDevice throws NOT_FOUND for unknown device auth id', async () => {
    const p = new FakeAuthProvider({});
    await expect(
      p.authorizeDevice('nope', { session: { id: 's', token: 't' } })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getAuthRequest("saml") returns a seeded SAML request and createSamlResponse honors binding', async () => {
    const p = new FakeAuthProvider({
      samlRequests: [{ id: 'saml-1', clientId: 'sp', binding: 'post' }],
    });
    expect(await p.getAuthRequest('saml', 'saml-1')).toMatchObject({ id: 'saml-1' });
    const r = await p.createSamlResponse('saml-1', { id: 's1', token: 't1' });
    expect(r).toMatchObject({
      binding: 'post',
      relayState: expect.any(String),
      samlResponse: expect.any(String),
    });
  });

  it('createSamlResponse uses redirect binding when seeded with binding: redirect', async () => {
    const p = new FakeAuthProvider({
      samlRequests: [{ id: 'saml-2', clientId: 'sp', binding: 'redirect' }],
    });
    const r = await p.createSamlResponse('saml-2', { id: 's1', token: 't1' });
    expect(r).toMatchObject({
      binding: 'redirect',
      url: expect.stringContaining('SAMLResponse='),
    });
    expect(r.relayState).toBeUndefined();
    expect(r.samlResponse).toBeUndefined();
  });

  it('startLdapIntent returns an intent for valid creds and throws on bad creds', async () => {
    const p = new FakeAuthProvider({
      ldapUsers: [{ username: 'bob', password: 'pw', userId: 'u2' }],
    });
    const intent = await p.startLdapIntent('idp-ldap', 'bob', 'pw');
    expect(intent).toMatchObject({
      userId: 'u2',
      idpIntentId: expect.any(String),
      idpIntentToken: expect.any(String),
    });
    await expect(p.startLdapIntent('idp-ldap', 'bob', 'wrong')).rejects.toThrow(
      /INVALID_CREDENTIALS/
    );
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
    // createSession with the returned intent must succeed and bind the correct user.
    const session = await p.createSession(
      { idpIntent: { idpIntentId, idpIntentToken } },
      { userId }
    );
    expect(session.user?.id).toBe('u13');
    expect(session.user?.loginName).toBe('ldap-bob@acme.test');
    expect(session.id).toMatch(/^sess-/);
    expect(session.factors.idpIntent?.verifiedAt).toBeTruthy();
  });
});
