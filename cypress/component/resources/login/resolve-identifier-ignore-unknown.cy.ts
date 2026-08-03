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

  it('ON: the ghost target is whatever a real PASSWORD-ONLY account resolves to', () => {
    // Pinned as a comparison, never as a literal. The ghost has no destination of its own — its
    // only job is to collide with the password-only account's, and a literal '/login/method' here
    // would pass just as happily on the day one of the two moves and the other does not.
    const seed = {
      users: [{ id: 'u1', loginName: 'alice@acme.test' }],
      authMethods: { u1: ['password'] as const },
      settingsByOrg: { 'org-default-fake': { ignoreUnknownUsernames: true } },
    };
    cy.wrap(null).then(async () => {
      const p = new FakeAuthProvider(seed as ConstructorParameters<typeof FakeAuthProvider>[0]);
      const known = await resolveIdentifier(p, [], {
        loginName: 'alice@acme.test',
        emailDeliveryEnabled: true,
      });
      const ghost = await resolveIdentifier(p, [], {
        loginName: 'ghost@acme.test',
        emailDeliveryEnabled: true,
      });
      expect(known.ok && 'target' in known && known.target).to.be.a('string');
      expect(ghost.ok && 'target' in ghost && ghost.target).to.equal(
        known.ok && 'target' in known && known.target
      );
      // And it really did plant a ceremony session, or /login/method's gate would bounce it.
      expect(ghost.ok && 'sessions' in ghost && ghost.sessions).to.have.length(1);
    });
  });
});
