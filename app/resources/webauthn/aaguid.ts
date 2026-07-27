// AAGUID extraction + default passkey naming.
//
// The attestation object is CBOR ({ fmt, attStmt, authData }); the AAGUID lives in
// authData's attested-credential-data block (bytes 37–52, present only when the AT
// flag is set). A minimal zero-dependency CBOR reader below covers exactly what an
// attestation object uses. EVERY failure path returns null — AAGUID lookup failure
// must NEVER block enrollment (spec §5).
//
// Vendored catalog: aaguid-names.json is { [aaguid]: name } stripped (icons removed)
// from the MIT-licensed community list:
//   https://github.com/passkeydeveloper/passkey-authenticator-aaguids
//   snapshot: commit 9e867bf9ed3b98a1673c09b461cba8d6755c7fc5 (aaguid.json, 2026-07-13)
import aaguidNames from './aaguid-names.json';
import { base64UrlToBuffer } from './webauthn';

// ── minimal CBOR reader ────────────────────────────────────────────────────────

interface Cursor {
  view: DataView;
  offset: number;
}

function readByte(c: Cursor): number {
  if (c.offset >= c.view.byteLength) throw new RangeError('cbor: out of bounds');
  return c.view.getUint8(c.offset++);
}

/** Read the length/value argument that follows a major-type head byte. */
function readArg(c: Cursor, info: number): number {
  if (info < 24) return info;
  if (info === 24) return readByte(c);
  if (info === 25) return (readByte(c) << 8) | readByte(c);
  if (info === 26)
    // `>>> 0` forces an unsigned 32-bit result — `<<` alone yields a signed int, wrong in
    // principle for a CBOR length/value even though attestation objects never approach 2^31.
    return ((readByte(c) << 24) | (readByte(c) << 16) | (readByte(c) << 8) | readByte(c)) >>> 0;
  // 64-bit / indefinite lengths never appear in attestation objects.
  throw new RangeError(`cbor: unsupported additional info ${info}`);
}

function readBytes(c: Cursor, length: number): Uint8Array {
  if (c.offset + length > c.view.byteLength) throw new RangeError('cbor: out of bounds');
  const out = new Uint8Array(c.view.buffer, c.view.byteOffset + c.offset, length);
  c.offset += length;
  return out;
}

/** Parse one CBOR item; byte/text strings return their payload, containers recurse. */
function readItem(c: Cursor): unknown {
  const head = readByte(c);
  const major = head >> 5;
  const info = head & 0x1f;
  switch (major) {
    case 0: // unsigned int
      return readArg(c, info);
    case 1: // negative int
      return -1 - readArg(c, info);
    case 2: // byte string
      return readBytes(c, readArg(c, info));
    case 3: {
      // text string
      const bytes = readBytes(c, readArg(c, info));
      return new TextDecoder().decode(bytes);
    }
    case 4: {
      // array
      const n = readArg(c, info);
      const arr: unknown[] = [];
      for (let i = 0; i < n; i++) arr.push(readItem(c));
      return arr;
    }
    case 5: {
      // map
      const n = readArg(c, info);
      const map = new Map<unknown, unknown>();
      for (let i = 0; i < n; i++) {
        const key = readItem(c);
        map.set(key, readItem(c));
      }
      return map;
    }
    case 6: // tag — skip the tag number, read the tagged item
      readArg(c, info);
      return readItem(c);
    default: // 7: simple values / floats — appear only inside attStmt variants we skip
      readArg(c, info);
      return null;
  }
}

// ── AAGUID extraction ──────────────────────────────────────────────────────────

const AT_FLAG = 0x40; // attested credential data present
const FLAGS_OFFSET = 32; // after the 32-byte rpIdHash
const AAGUID_OFFSET = 37; // rpIdHash(32) + flags(1) + signCount(4)
const AAGUID_END = 53; // + aaguid(16)
const MIN_AUTH_DATA_LENGTH = 55; // + credIdLen(2) — shortest authData carrying an AAGUID

/**
 * Extract the authenticator AAGUID from a base64url attestation object.
 * Returns the lowercase hyphenated UUID, or null on ANY failure (malformed
 * input, truncated CBOR, missing AT flag) — never throws.
 */
export function aaguidFromAttestationObject(attestationObjectB64Url: string): string | null {
  try {
    const buf = base64UrlToBuffer(attestationObjectB64Url);
    const item = readItem({ view: new DataView(buf), offset: 0 });
    if (!(item instanceof Map)) return null;
    const authData = item.get('authData');
    if (!(authData instanceof Uint8Array) || authData.length < MIN_AUTH_DATA_LENGTH) return null;
    if ((authData[FLAGS_OFFSET] & AT_FLAG) === 0) return null; // no attested credential data
    const hex = [...authData.slice(AAGUID_OFFSET, AAGUID_END)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

// ── default naming ─────────────────────────────────────────────────────────────

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/** Coarse UA → '<Browser> on <OS>' fallback (English product nouns, matching the catalog). */
function nameFromUserAgent(userAgent: string): string {
  const browser = /Edg(?:e|A|iOS)?\//.test(userAgent)
    ? 'Edge'
    : /OPR\/|Opera/.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : null;
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad|iOS/.test(userAgent)
      ? 'iOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  if (!browser || !os) return 'This device';
  return `${browser} on ${os}`;
}

/**
 * Resolve the pre-filled passkey name: vendored catalog by AAGUID (skipping the
 * null/zero UUID), else a UA-derived '<Browser> on <OS>' label.
 */
export function defaultPasskeyName(aaguid: string | null, userAgent: string): string {
  if (aaguid && aaguid !== ZERO_UUID) {
    const name = (aaguidNames as Record<string, string>)[aaguid];
    if (name) return name;
  }
  return nameFromUserAgent(userAgent);
}
