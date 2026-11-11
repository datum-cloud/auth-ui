// cypress/component/modules/auth/providers/fake/fake-provider.passkey-code.cy.ts
//
// Phase C Lane D · Task 2 — the passkey registration-code envelope and a fake that checks it.
//
// The recovery ceremony hands a code back to registerPasskey that came from a mail, so the fake
// has to behave like Zitadel on the two properties recovery depends on: a WRONG code is refused,
// and a code is SINGLE USE. Without those the /recover specs would pass against a fake that
// accepts anything. Legacy direct callers (webauthn.service, parity) never mint a code and must
// keep working with an opaque string.
import {
  decodePasskeyRegistrationCode,
  encodePasskeyRegistrationCode,
} from '@/modules/auth/passkey-registration-code';
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { ProviderError } from '@/modules/auth/types';

const user = { id: 'u1', loginName: 'a@acme.test' };

describe('passkey registration code — envelope codec', () => {
  it('round-trips { id, code } through the opaque envelope', () => {
    const opaque = encodePasskeyRegistrationCode({ id: 'code-1', code: 'ABC123XY' });
    expect(decodePasskeyRegistrationCode(opaque)).to.deep.equal({
      id: 'code-1',
      code: 'ABC123XY',
    });
  });

  it('returns null for anything that is not a complete envelope', () => {
    expect(decodePasskeyRegistrationCode('legacy-opaque')).to.equal(null);
    expect(decodePasskeyRegistrationCode('')).to.equal(null);
    expect(decodePasskeyRegistrationCode('{"id":"a"}')).to.equal(null);
    expect(decodePasskeyRegistrationCode('{"id":"","code":"b"}')).to.equal(null);
    expect(decodePasskeyRegistrationCode('{"id":1,"code":2}')).to.equal(null);
  });
});

describe('FakeAuthProvider — passkey registration code validation', () => {
  it('mints an envelope whose id and code are both non-empty', async () => {
    const p = new FakeAuthProvider({ users: [user] });
    const { code } = await p.passkeyRegisterLink('u1');
    const decoded = decodePasskeyRegistrationCode(code);
    expect(decoded).to.not.equal(null);
    expect(decoded?.id).to.be.a('string').and.not.equal('');
    expect(decoded?.code).to.be.a('string').and.not.equal('');
  });

  it('rejects a minted user registering with the WRONG code', async () => {
    const p = new FakeAuthProvider({ users: [user] });
    const { code } = await p.passkeyRegisterLink('u1');
    const wrong = encodePasskeyRegistrationCode({
      id: decodePasskeyRegistrationCode(code)!.id,
      code: 'WRONG',
    });

    let err: unknown;
    try {
      await p.registerPasskey('u1', wrong, 'localhost');
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(ProviderError);
    expect((err as ProviderError).code).to.equal('INVALID_CREDENTIALS');
  });

  it('accepts the right code exactly once — a second use is refused (single use, like Zitadel)', async () => {
    const p = new FakeAuthProvider({ users: [user] });
    const { code } = await p.passkeyRegisterLink('u1');

    const opts = await p.registerPasskey('u1', code, 'localhost');
    expect(opts.passkeyId).to.be.a('string').and.not.equal('');

    let err: unknown;
    try {
      await p.registerPasskey('u1', code, 'localhost');
    } catch (e) {
      err = e;
    }
    expect(err, 'a consumed code is gone').to.be.instanceOf(ProviderError);
    expect((err as ProviderError).code).to.equal('INVALID_CREDENTIALS');
  });

  it('leaves legacy direct callers alone: no minted code means no validation', async () => {
    const p = new FakeAuthProvider({ users: [user, { id: 'u2', loginName: 'b@acme.test' }] });
    const opts = await p.registerPasskey('u2', 'legacy-opaque', 'localhost');
    expect(opts.passkeyId).to.be.a('string').and.not.equal('');
  });
});
