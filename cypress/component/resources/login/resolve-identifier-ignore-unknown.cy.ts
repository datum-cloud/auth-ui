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
});
