// cypress/component/modules/auth/providers/fake/fake-provider.idp.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/fake/__tests__/fake-provider.idp.test.ts.
//
// NOTE: this exercises a FAKE provider (test double / harness), not production security logic.
// One representative test per distinct capability.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

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
    },
  });
}

describe('FakeAuthProvider — IdP', () => {
  it('lists active IdPs, starts an intent, retrieves a linked intent, creates a session from it, and adds/lists/removes idp links', async () => {
    const p = provider();
    expect(await p.getActiveIdPs()).to.have.length(1);

    const started = await p.startIdpIntent('idp-g', { success: 's', failure: 'f' });
    expect(started.authUrl).to.include('idp-g');

    const retrieved = (await p.retrieveIdpIntent('intent-linked', 'tok')) as {
      userId: string | null;
    };
    expect(retrieved.userId).to.equal('u1');

    const s = await p.createSession({
      idpIntent: { idpIntentId: 'intent-linked', idpIntentToken: 'tok' },
    });
    expect(s.factors.idpIntent?.verifiedAt).to.not.be.null;

    await p.addIdpLink('u1', { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'alice' });
    expect(await p.listIdpLinks('u1')).to.have.length(1);
    await p.removeIdpLink('u1', 'idp-g', 'g-1');
    expect(await p.listIdpLinks('u1')).to.have.length(0);
  });
});
