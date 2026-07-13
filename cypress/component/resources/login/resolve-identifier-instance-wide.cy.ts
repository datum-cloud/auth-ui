// cypress/component/resources/login/resolve-identifier-instance-wide.cy.ts
//
// Asserts that resolveIdentifier calls findUser with org=undefined when no organization
// is passed (the instance-wide lookup that fixes USER_NOT_FOUND for cross-org users).
// Uses the direct FakeAuthProvider + spy pattern (mirrors resolve-identifier-domain-discovery.cy.ts).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier } from '@/resources/login';

describe('resolveIdentifier — instance-wide lookup when no organization', () => {
  it('calls findUser with org=undefined (no default-org injection into the lookup)', async () => {
    // Seed a user in a non-default org — they are only findable instance-wide
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'alice@other-org.test', orgId: 'other-org' }],
      authMethods: { u1: ['password'] },
    });

    // Spy on findUser to capture the org argument
    const orgArgs: (string | undefined)[] = [];
    const realFindUser = p.findUser.bind(p);
    p.findUser = ((loginName: string, org?: string) => {
      orgArgs.push(org);
      return realFindUser(loginName, org);
    }) as typeof p.findUser;

    // Call without organization → should search instance-wide
    await resolveIdentifier(p, [], {
      loginName: 'alice@other-org.test',
      emailDeliveryEnabled: true,
      // no organization
    });

    // The org arg to findUser must be undefined (instance-wide, not default-org-scoped)
    expect(orgArgs[0]).to.equal(undefined);
  });
});
