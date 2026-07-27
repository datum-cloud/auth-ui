// cypress/support/attestation-fixture.ts
//
// Tiny CBOR writer producing a minimal-but-valid WebAuthn attestation object
// { fmt: 'none', attStmt: {}, authData } as base64url. Shared by the aaguid unit
// spec and the setup/passkey naming route spec (AAGUID pre-fill).

function cborText(s: string): number[] {
  const bytes = [...new TextEncoder().encode(s)];
  return [0x60 + bytes.length, ...bytes]; // major 3, len < 24
}
function cborBytes(b: number[]): number[] {
  if (b.length < 24) return [0x40 + b.length, ...b]; // major 2, len < 24
  if (b.length < 256) return [0x58, b.length, ...b]; // major 2, 1-byte length
  return [0x59, b.length >> 8, b.length & 0xff, ...b]; // major 2, 2-byte length
}

/** Map { fmt: 'none', attStmt: {}, authData: <bytes> } — key order as browsers emit. */
export function attestationObject(authData: number[]): string {
  const map = [
    0xa3, // map(3)
    ...cborText('fmt'),
    ...cborText('none'),
    ...cborText('attStmt'),
    0xa0, // map(0)
    ...cborText('authData'),
    ...cborBytes(authData),
  ];
  // base64url encode
  const bin = String.fromCharCode(...map);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** authData: 32-byte rpIdHash + flags + 4-byte signCount [+ 16-byte AAGUID + credIdLen]. */
export function authDataWith(flags: number, aaguidHex?: string): number[] {
  const rpIdHash = Array.from({ length: 32 }, () => 0x11);
  const signCount = [0, 0, 0, 1];
  const out = [...rpIdHash, flags, ...signCount];
  if (aaguidHex !== undefined) {
    const aaguid = aaguidHex.match(/.{2}/g)!.map((h) => parseInt(h, 16));
    out.push(...aaguid, 0x00, 0x00); // AAGUID + 2-byte credIdLen (0)
  }
  return out;
}
