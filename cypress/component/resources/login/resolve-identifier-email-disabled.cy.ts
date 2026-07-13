// cypress/component/resources/login/resolve-identifier-email-disabled.cy.ts
//
// Component (no-mount) port of resolve-identifier-email-disabled.test.ts.
// Uses fresh FakeAuthProvider instances; no cy.mount needed.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier } from '@/resources/login';

describe('resolveIdentifier — disableLoginWithEmail (detect-for-copy)', () => {
  it('OFF (default): email-shaped unknown identifier → USER_NOT_FOUND (unchanged)', async () => {
    const p = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'alice' }] });
    const r = await resolveIdentifier(p, [], {
      loginName: 'ghost@acme.test',
      emailDeliveryEnabled: true,
    });
    expect(r).to.deep.equal({ ok: false, error: 'USER_NOT_FOUND' });
  });
});
