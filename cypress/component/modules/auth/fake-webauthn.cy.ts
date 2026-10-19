// NO-MOUNT: FakeWebAuthn option shapes and cryptographic verification. The ceremonies run
// node-side (callService → fakeWebAuthn) because the software authenticator signs with Node crypto.
import { PASSKEY_U5 } from '../../../fixtures/passkey-u5';
import { callService } from '../../../support/node/call-service';

describe('FakeWebAuthn', () => {
  it('creationOptions sets rp.id from domain and user.id to base64url(userId)', () => {
    callService({ fn: 'fakeWebAuthn', fakeWebAuthnOp: 'creationOptions' }).then((v) => {
      expect(v.outcome.rpId).to.equal('localhost');
      expect(v.outcome.userId).to.equal('dTU');
    });
  });

  it('verifyAssertion accepts the prebaked credential id unchanged', () => {
    callService({ fn: 'fakeWebAuthn', fakeWebAuthnOp: 'prebaked' }).then((v) => {
      expect(v.outcome).to.deep.equal({ userVerified: true });
    });
  });

  it('verifyAssertion verifies a correctly signed assertion for a seeded credential', () => {
    callService({ fn: 'fakeWebAuthn', fakeWebAuthnOp: 'signed' }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: true, userVerified: true });
    });
  });

  const rejected: Array<
    [string, NonNullable<Parameters<typeof callService>[0]['fakeWebAuthnOp']>]
  > = [
    ['an unknown credential id', 'unknownId'],
    ['a valid signature over a challenge not issued for this session', 'wrongChallenge'],
    ['a wrong origin', 'wrongOrigin'],
    ['a mangled signature', 'mangledSignature'],
    ['a credential owned by another user', 'otherUser'],
    ['an assertion from an insecure origin on a non-localhost domain', 'prodOriginHttp'],
  ];
  for (const [name, op] of rejected) {
    it(`rejects ${name}`, () => {
      callService({ fn: 'fakeWebAuthn', fakeWebAuthnOp: op }).then((v) => {
        expect(v.outcome).to.deep.equal({ ok: false, code: 'INVALID_CREDENTIALS' });
      });
    });
  }

  it('verifyAssertion accepts the https origin of a non-localhost domain', () => {
    callService({ fn: 'fakeWebAuthn', fakeWebAuthnOp: 'prodOriginHttps' }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: true, userVerified: true });
    });
  });
});

describe('FakeWebAuthn registration', () => {
  it('verifyRegistration accepts a valid attestation for a new credential', () => {
    callService({ fn: 'fakeWebAuthn', fakeWebAuthnOp: 'registerSuccess' }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: true });
    });
  });

  it('rejects a registration with no pending challenge for its key', () => {
    callService({ fn: 'fakeWebAuthn', fakeWebAuthnOp: 'registerUnknownKey' }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, code: 'INVALID_CREDENTIALS' });
    });
  });

  it('rejects a registration whose credential id is owned by another user', () => {
    callService({ fn: 'fakeWebAuthn', fakeWebAuthnOp: 'registerOtherUser' }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, code: 'INVALID_CREDENTIALS' });
    });
  });
});

describe('FakeAuthProvider session passkey check', () => {
  const seed = {
    users: [{ id: 'u5', loginName: 'u5@acme.test' }],
    webauthnCredentials: [
      {
        id: PASSKEY_U5.credentialId,
        publicKey: PASSKEY_U5.publicKeyCose,
        counter: 0,
        userId: PASSKEY_U5.userId,
      },
    ],
  };
  const run = (op: 'signed' | 'twoSessions' | 'unknownCredential' | 'prebaked') =>
    callService({ fn: 'sessionWebAuthn', provider: 'fresh', seed, sessionWebAuthnOp: op });

  it('a session armed for u5 accepts a correctly signed assertion and stamps the passkey factor', () => {
    run('signed').then((v) => {
      expect(v.outcome.ok).to.equal(true);
      expect(v.outcome.passkey.userVerified).to.equal(true);
    });
  });

  it('arming a challenge on session B does not invalidate session A', () => {
    run('twoSessions').then((v) => {
      expect(v.outcome.ok).to.equal(true);
      expect(v.outcome.passkey.userVerified).to.equal(true);
    });
  });

  it('an unknown credential on updateSession throws INVALID_CREDENTIALS and stamps nothing', () => {
    run('unknownCredential').then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, code: 'INVALID_CREDENTIALS', passkey: null });
    });
  });

  it('the prebaked credential still stamps the passkey factor for u5', () => {
    run('prebaked').then((v) => {
      expect(v.outcome.ok).to.equal(true);
      expect(v.outcome.passkey.userVerified).to.equal(true);
    });
  });
});
