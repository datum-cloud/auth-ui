// cypress/component/modules/auth/fake-passkeys.cy.ts
//
// NO-MOUNT: FakeAuthProvider passkey-inventory mirror of the port additions
// (listPasskeys / removePasskey). Style of cypress/component/routes/paths.cy.ts.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

const seedUser = { id: 'u1', loginName: 'alice@acme.test' };

describe('FakeAuthProvider — passkey inventory (port mirror)', () => {
  it('verifyPasskey records a named active passkey; listPasskeys returns it', async () => {
    const fake = new FakeAuthProvider({ users: [seedUser] });
    await fake.verifyPasskey('u1', 'pk-1', {}, 'MacBook Touch ID');
    const [passkey] = await fake.listPasskeys('u1');
    const { createdAt, ...rest } = passkey;
    expect(rest).to.deep.equal({ id: 'pk-1', state: 'active', name: 'MacBook Touch ID' });
    expect(createdAt).to.be.a('string');
    expect(new Date(createdAt).toISOString()).to.equal(createdAt);
    expect(await fake.listAuthMethods('u1')).to.include('passkey');
  });

  it('defaults the name when verifyPasskey gets no passkeyName (Zitadel parity)', async () => {
    const fake = new FakeAuthProvider({ users: [seedUser] });
    await fake.verifyPasskey('u1', 'pk-1', {});
    expect((await fake.listPasskeys('u1'))[0].name).to.equal('Passkey');
  });

  it('removePasskey is idempotent and un-enrolls the method with the last passkey', async () => {
    const fake = new FakeAuthProvider({ users: [seedUser] });
    await fake.verifyPasskey('u1', 'pk-1', {}, 'A');
    await fake.removePasskey('u1', 'pk-1');
    await fake.removePasskey('u1', 'pk-1'); // second call must not throw (removal race)
    expect(await fake.listPasskeys('u1')).to.deep.equal([]);
    expect(await fake.listAuthMethods('u1')).to.not.include('passkey');
  });

  it('honors the passkeys seed (e2e fixture path)', async () => {
    const fake = new FakeAuthProvider({
      users: [seedUser],
      passkeys: { u1: [{ id: 'pk-s', state: 'active', name: 'Seeded key' }] },
    });
    expect(await fake.listPasskeys('u1')).to.have.length(1);
  });

  it('removePasskey also clears a SEEDED static authMethods entry, not just the dynamic enrolled set', async () => {
    // listAuthMethods unions the dynamic `enrolled` set with the seed-time `authMethods`
    // array — a test seeding BOTH (the e2e-fixture pattern) would otherwise still see
    // 'passkey' reported as enrolled after the last passkey is removed, since only the
    // dynamic set was ever cleared.
    const fake = new FakeAuthProvider({
      users: [seedUser],
      authMethods: { u1: ['passkey'] },
      passkeys: { u1: [{ id: 'pk-s', state: 'active', name: 'Seeded key' }] },
    });
    expect(await fake.listAuthMethods('u1')).to.include('passkey');
    await fake.removePasskey('u1', 'pk-s');
    expect(await fake.listPasskeys('u1')).to.deep.equal([]);
    expect(await fake.listAuthMethods('u1')).to.not.include('passkey');
  });
});
