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

/**
 * Stable, UI-facing classification of why a WebAuthn ceremony failed. The browser surfaces
 * failures as thrown DOMExceptions (or a null return on user-cancel); `classifyWebAuthnError`
 * collapses those into this closed set so the button can show reason-specific copy.
 */
export type WebAuthnReason =
  'not-allowed' | 'already-registered' | 'unsupported' | 'security' | 'unknown';

/** Thrown by the ceremony wrappers when navigator.credentials.create/get fails (throw or null). */
export class WebAuthnCeremonyError extends Error {
  readonly reason: WebAuthnReason;
  constructor(reason: WebAuthnReason) {
    super(`WebAuthn ceremony failed: ${reason}`);
    this.name = 'WebAuthnCeremonyError';
    this.reason = reason;
  }
}

/**
 * Map a value thrown by navigator.credentials.create()/get() to a stable reason.
 * Real failures are DOMExceptions whose `.name` disambiguates the cause; any non-DOMException
 * value (or an unmapped DOMException name) is treated as 'unknown'.
 */
export function classifyWebAuthnError(err: unknown): WebAuthnReason {
  if (!(err instanceof DOMException)) return 'unknown';
  switch (err.name) {
    case 'NotAllowedError':
    case 'AbortError':
    case 'TimeoutError':
      return 'not-allowed';
    case 'InvalidStateError':
      return 'already-registered';
    case 'NotSupportedError':
    case 'ConstraintError':
      return 'unsupported';
    case 'SecurityError':
      return 'security';
    default:
      return 'unknown';
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
  // navigator.credentials.get THROWS a DOMException on real failure (no authenticator,
  // cancel, timeout) and resolves null on user-cancel. Classify the throw into a reason;
  // treat null as a user-cancel ('not-allowed'). Cast pk through unknown: the spread rebuilds
  // a valid options shape but TypeScript cannot verify all required DOM fields
  // (e.g. allowCredentials[].type) are present.
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: pk as unknown as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw new WebAuthnCeremonyError(classifyWebAuthnError(err));
  }
  if (!cred) throw new WebAuthnCeremonyError('not-allowed');
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
  // navigator.credentials.create THROWS a DOMException on real failure (no authenticator,
  // cancel, already-registered) and resolves null on user-cancel. Classify the throw into a
  // reason; treat null as a user-cancel ('not-allowed'). Cast pk through unknown: the spread
  // rebuilds a valid options shape but TypeScript cannot verify all required DOM fields
  // (rp, pubKeyCredParams, etc.) are present on the spread.
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: pk as unknown as PublicKeyCredentialCreationOptions,
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw new WebAuthnCeremonyError(classifyWebAuthnError(err));
  }
  if (!cred) throw new WebAuthnCeremonyError('not-allowed');
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
