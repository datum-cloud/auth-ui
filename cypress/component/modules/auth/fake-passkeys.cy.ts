// cypress/component/modules/auth/fake-passkeys.cy.ts
//
// NO-MOUNT: FakeAuthProvider passkey-inventory mirror of the port additions
// (listPasskeys / removePasskey). Style of cypress/component/routes/paths.cy.ts.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

const seedUser = { id: 'u1', loginName: 'alice@acme.test' };

describe('FakeAuthProvider — passkey inventory (port mirror)', () => {
  it('records a named active passkey with an ISO createdAt, defaulting the name when absent', async () => {
    const named = new FakeAuthProvider({ users: [seedUser] });
    await named.verifyPasskey('u1', 'pk-1', {}, 'MacBook Touch ID');
    const [passkey] = await named.listPasskeys('u1');
    const { createdAt, ...rest } = passkey;
    expect(rest).to.deep.equal({ id: 'pk-1', state: 'active', name: 'MacBook Touch ID' });
    expect(createdAt).to.be.a('string');
    expect(new Date(createdAt).toISOString()).to.equal(createdAt);
    expect(await named.listAuthMethods('u1')).to.include('passkey');

    // Same call minus the 4th arg — on a fresh provider so the default is observed on a
    // passkey this case created, not one left over from the named case above.
    const unnamed = new FakeAuthProvider({ users: [seedUser] });
    await unnamed.verifyPasskey('u1', 'pk-1', {});
    expect((await unnamed.listPasskeys('u1'))[0].name).to.equal('Passkey');
  });

  it('removes idempotently, honors the seed, and clears both the enrolled and seeded methods', async () => {
    // Dynamically enrolled passkey: removing the last one un-enrolls the method, and a
    // second remove must not throw (removal race).
    const enrolled = new FakeAuthProvider({ users: [seedUser] });
    await enrolled.verifyPasskey('u1', 'pk-1', {}, 'A');
    await enrolled.removePasskey('u1', 'pk-1');
    await enrolled.removePasskey('u1', 'pk-1');
    expect(await enrolled.listPasskeys('u1')).to.deep.equal([]);
    expect(await enrolled.listAuthMethods('u1')).to.not.include('passkey');

    // listAuthMethods unions the dynamic `enrolled` set with the seed-time `authMethods`
    // array — a test seeding BOTH (the e2e-fixture pattern) would otherwise still see
    // 'passkey' reported as enrolled after the last passkey is removed, since only the
    // dynamic set was ever cleared.
    const fromSeed = new FakeAuthProvider({
      users: [seedUser],
      authMethods: { u1: ['passkey'] },
      passkeys: { u1: [{ id: 'pk-s', state: 'active', name: 'Seeded key' }] },
    });
    // Asserted BEFORE the removal on purpose: this is what proves the `passkeys` seed is
    // honored at all. A provider that ignored the seed would still pass the length-0 check
    // after removePasskey, so the post-removal assertion alone cannot stand in for it.
    expect(await fromSeed.listPasskeys('u1')).to.have.length(1);
    expect(await fromSeed.listAuthMethods('u1')).to.include('passkey');
    await fromSeed.removePasskey('u1', 'pk-s');
    expect(await fromSeed.listPasskeys('u1')).to.deep.equal([]);
    expect(await fromSeed.listAuthMethods('u1')).to.not.include('passkey');
  });
});
