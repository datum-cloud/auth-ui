import { FakeAuthProvider } from './fake-provider';
import { describe, it, expect } from 'vitest';

function provider() {
  return new FakeAuthProvider({
    users: [{ id: 'u1', loginName: 'alice@acme.test' }],
    idps: [{ id: 'idp-g', name: 'Google', type: 'GOOGLE' }],
    idpIntents: {
      'intent-linked': {
        information: { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'alice' },
        userId: 'u1',
        draft: null,
      },
      'intent-new': {
        information: { idpId: 'idp-g', idpUserId: 'g-2', idpUserName: 'bob' },
        userId: null,
        draft: { email: 'bob@acme.test', firstName: 'Bob', lastName: 'B' },
      },
    },
  });
}

describe('FakeAuthProvider — IdP', () => {
  it('lists active IdPs', async () => {
    expect(await provider().getActiveIdPs()).toHaveLength(1);
  });
  it('starts an intent returning an authUrl', async () => {
    const r = await provider().startIdpIntent('idp-g', { success: 's', failure: 'f' });
    expect(r.authUrl).toContain('idp-g');
  });
  it('retrieves a linked intent (userId present)', async () => {
    const r = (await provider().retrieveIdpIntent('intent-linked', 'tok')) as {
      userId: string | null;
    };
    expect(r.userId).toBe('u1');
  });
  it('creates a session from an idpIntent check', async () => {
    const p = provider();
    const s = await p.createSession({
      idpIntent: { idpIntentId: 'intent-linked', idpIntentToken: 'tok' },
    });
    expect(s.factors.idpIntent?.verifiedAt).not.toBeNull();
  });
  it('adds and lists idp links, then removes', async () => {
    const p = provider();
    await p.addIdpLink('u1', { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'alice' });
    expect(await p.listIdpLinks('u1')).toHaveLength(1);
    await p.removeIdpLink('u1', 'idp-g', 'g-1');
    expect(await p.listIdpLinks('u1')).toHaveLength(0);
  });
});
