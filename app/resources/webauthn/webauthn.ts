export function base64UrlToBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class WebAuthnUnsupportedError extends Error {
  constructor() {
    super('WebAuthn is not supported in this browser');
    this.name = 'WebAuthnUnsupportedError';
  }
}

export class WebAuthnCeremonyCancelledError extends Error {
  constructor() {
    super('WebAuthn ceremony was cancelled or returned no credential');
    this.name = 'WebAuthnCeremonyCancelledError';
  }
}

// Server-issued challenge options are an opaque JSON object whose `challenge` (and, for
// assertion, `allowCredentials[].id`; for attestation, `user.id`/`excludeCredentials[].id`)
// are base64url strings we decode before handing to the WebAuthn API.
export interface WebAuthnChallengeInput {
  challenge: string;
  [key: string]: unknown;
}

export function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
}

/** USE: marshal a server assertion challenge through navigator.credentials.get. Returns plain JSON for the provider. */
export async function marshalAssertion(
  publicKey: WebAuthnChallengeInput
): Promise<Record<string, unknown>> {
  if (!isWebAuthnSupported()) throw new WebAuthnUnsupportedError();
  const pk = {
    ...publicKey,
    challenge: base64UrlToBuffer(publicKey.challenge),
    allowCredentials: (
      (publicKey.allowCredentials ?? []) as Array<Record<string, unknown> & { id: string }>
    ).map((c) => ({
      ...c,
      id: base64UrlToBuffer(c.id),
    })),
  };
  // CODE-MIN-08: navigator.credentials.get resolves null on user cancel; cast + deref without
  // a null check would throw an opaque TypeError. Throw a named error instead.
  // Cast pk through unknown: the spread rebuilds a valid options shape but TypeScript cannot
  // verify that all required DOM fields (e.g. allowCredentials[].type) are present.
  const cred = (await navigator.credentials.get({
    publicKey: pk as unknown as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new WebAuthnCeremonyCancelledError();
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64Url(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bufferToBase64Url(r.authenticatorData),
      clientDataJSON: bufferToBase64Url(r.clientDataJSON),
      signature: bufferToBase64Url(r.signature),
      userHandle: r.userHandle ? bufferToBase64Url(r.userHandle) : null,
    },
  };
}

/** ENROLL: marshal a server attestation challenge through navigator.credentials.create. */
export async function createAttestation(
  publicKey: WebAuthnChallengeInput
): Promise<Record<string, unknown>> {
  if (!isWebAuthnSupported()) throw new WebAuthnUnsupportedError();
  const user = publicKey.user as Record<string, unknown> & { id: string };
  const pk = {
    ...publicKey,
    challenge: base64UrlToBuffer(publicKey.challenge),
    user: { ...user, id: base64UrlToBuffer(user.id) },
    excludeCredentials: (
      (publicKey.excludeCredentials ?? []) as Array<Record<string, unknown> & { id: string }>
    ).map((c) => ({
      ...c,
      id: base64UrlToBuffer(c.id),
    })),
  };
  // CODE-MIN-08: navigator.credentials.create resolves null on user cancel; null-guard here
  // instead of letting the next line throw an opaque TypeError.
  // Cast pk through unknown: the spread rebuilds a valid options shape but TypeScript cannot
  // verify all required DOM fields (rp, pubKeyCredParams, etc.) are present on the spread.
  const cred = (await navigator.credentials.create({
    publicKey: pk as unknown as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new WebAuthnCeremonyCancelledError();
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64Url(cred.rawId),
    type: cred.type,
    response: {
      attestationObject: bufferToBase64Url(r.attestationObject),
      clientDataJSON: bufferToBase64Url(r.clientDataJSON),
    },
  };
}
