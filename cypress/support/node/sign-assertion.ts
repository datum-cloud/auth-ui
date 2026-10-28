// cypress/support/node/sign-assertion.ts
//
// Node-side software authenticator for specs: builds the JSON shape marshalAssertion posts
// (base64url fields) for a given PKCS#8 P-256 key, as a UV+UP platform authenticator would.
import { createHash, createPrivateKey, createSign } from 'node:crypto';

export interface SignAssertionOpts {
  credentialId: string;
  privateKeyPkcs8B64: string;
  userId: string;
  challenge: string;
  origin: string;
  rpId: string;
  counter: number;
  userVerified?: boolean;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export function signAssertion(opts: SignAssertionOpts): Record<string, unknown> {
  const rpIdHash = createHash('sha256').update(opts.rpId).digest();
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(opts.counter);
  const authenticatorData = Buffer.concat([
    rpIdHash,
    Buffer.from([opts.userVerified === false ? FLAG_UP : FLAG_UP | FLAG_UV]),
    counter,
  ]);
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge: opts.challenge, origin: opts.origin })
  );
  const key = createPrivateKey({
    key: Buffer.from(opts.privateKeyPkcs8B64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const signature = createSign('sha256')
    .update(
      Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()])
    )
    .sign(key);
  return {
    id: opts.credentialId,
    rawId: opts.credentialId,
    type: 'public-key',
    response: {
      authenticatorData: authenticatorData.toString('base64url'),
      clientDataJSON: clientDataJSON.toString('base64url'),
      signature: signature.toString('base64url'),
      userHandle: Buffer.from(opts.userId, 'utf8').toString('base64url'),
    },
  };
}

export interface SignAttestationOpts {
  credentialId: string;
  publicKeyCose: string;
  challenge: string;
  origin: string;
  rpId: string;
  userVerified?: boolean;
}

const cborText = (s: string) => Buffer.concat([Buffer.from([0x60 + s.length]), Buffer.from(s)]);

/** A `none`-format registration response, as a platform authenticator would build it (UV set unless `userVerified` is false). */
export function signAttestation(opts: SignAttestationOpts): Record<string, unknown> {
  const credId = Buffer.from(opts.credentialId, 'base64url');
  const idLen = Buffer.alloc(2);
  idLen.writeUInt16BE(credId.length);
  const authData = Buffer.concat([
    createHash('sha256').update(opts.rpId).digest(),
    Buffer.from([FLAG_UP | FLAG_AT | (opts.userVerified === false ? 0 : FLAG_UV)]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    idLen,
    credId,
    Buffer.from(opts.publicKeyCose, 'base64url'),
  ]);
  const attestationObject = Buffer.concat([
    Buffer.from([0xa3]),
    cborText('fmt'),
    cborText('none'),
    cborText('attStmt'),
    Buffer.from([0xa0]),
    cborText('authData'),
    Buffer.from([0x59, authData.length >> 8, authData.length & 0xff]),
    authData,
  ]);
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge, origin: opts.origin })
  );
  return {
    id: opts.credentialId,
    rawId: opts.credentialId,
    type: 'public-key',
    response: {
      attestationObject: attestationObject.toString('base64url'),
      clientDataJSON: clientDataJSON.toString('base64url'),
      transports: ['internal'],
    },
  };
}
