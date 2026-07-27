// cypress/component/modules/auth/providers/fake/fake-provider-idp-intent.cy.ts
//
// FakeAuthProvider.updateSession must replicate Zitadel's own identity-binding
// enforcement for idpIntent checks: a session can only be verified with an
// idpIntent that resolves to THAT session's own user.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { ProviderError } from '@/modules/auth/types';

describe('FakeAuthProvider.updateSession — idpIntent check', () => {
  it("stamps the idpIntent factor when the intent resolves to the session's own user", async () => {
    const fake = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'mia@acme.test' }],
      idpIntents: {
        'intent-1': { idpIntentId: 'intent-1', idpIntentToken: 'tok-1', userId: 'u1' },
      },
    });
    const s = await fake.createSession({}, { userId: 'u1' });
    const updated = await fake.updateSession(s.id, s.token, {
      idpIntent: { idpIntentId: 'intent-1', idpIntentToken: 'tok-1' },
    });
    expect(updated.factors.idpIntent?.verifiedAt).to.not.equal(null);
  });

  it("rejects an idpIntent that resolves to a DIFFERENT user than the session's own", async () => {
    const fake = new FakeAuthProvider({
      users: [
        { id: 'u1', loginName: 'mia@acme.test' },
        { id: 'u2', loginName: 'bob@acme.test' },
      ],
      idpIntents: {
        'intent-2': { idpIntentId: 'intent-2', idpIntentToken: 'tok-2', userId: 'u2' },
      },
    });
    const s = await fake.createSession({}, { userId: 'u1' });
    let threw: unknown;
    try {
      await fake.updateSession(s.id, s.token, {
        idpIntent: { idpIntentId: 'intent-2', idpIntentToken: 'tok-2' },
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(ProviderError);
    expect((threw as ProviderError).code).to.equal('FAILED_PRECONDITION');
  });

  it('rejects an unseeded/unknown idpIntentId', async () => {
    const fake = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'mia@acme.test' }] });
    const s = await fake.createSession({}, { userId: 'u1' });
    let threw: unknown;
    try {
      await fake.updateSession(s.id, s.token, {
        idpIntent: { idpIntentId: 'no-such-intent', idpIntentToken: 'x' },
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(ProviderError);
    expect((threw as ProviderError).code).to.equal('FAILED_PRECONDITION');
  });
});
