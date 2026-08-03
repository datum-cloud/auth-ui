// cypress/component/resources/webauthn/aaguid.cy.ts
//
// NO-MOUNT: AAGUID extraction from a WebAuthn attestation object + default-name
// resolution (vendored catalog → UA fallback). Fixtures are built with the shared
// CBOR writer in cypress/support/attestation-fixture.ts — a minimal-but-valid
// attestation object { fmt, attStmt, authData }.
import { attestationObject, authDataWith } from '../../../support/attestation-fixture';
import { aaguidFromAttestationObject, defaultPasskeyName } from '@/resources/webauthn/aaguid';

const MAC_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

const APPLE_AAGUID = 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd';
const ZERO_AAGUID = '00000000-0000-0000-0000-000000000000';

// Extraction: every input shape, valid and malformed. A null result must never throw —
// AAGUID failure must not block enrollment.
const EXTRACTION: [label: string, input: string, expected: string | null][] = [
  // fbfc3007-... is Apple's authenticator.
  [
    'known AAGUID',
    attestationObject(authDataWith(0x45, 'fbfc3007154e4ecc8c0b6e020557d7bd')),
    APPLE_AAGUID,
  ],
  [
    'zeroed AAGUID',
    attestationObject(authDataWith(0x45, '00000000000000000000000000000000')),
    ZERO_AAGUID,
  ],
  // UP only, no AT flag → no attested credential data at all.
  ['AT flag absent', attestationObject(authDataWith(0x01)), null],
  ['garbage', '!!!', null],
  ['empty string', '', null],
  // truncated CBOR: a map header promising entries that never arrive
  ['truncated CBOR', 'owFj', null],
];

// Naming: catalog hit, catalog miss → UA, no AAGUID → UA, and no UA either → generic.
const NAMING: [label: string, aaguid: string | null, ua: string, expected: string][] = [
  // 'Apple Passwords' in the vendored catalog snapshot, upstream 9e867bf.
  ['catalog hit', APPLE_AAGUID, MAC_CHROME_UA, 'Apple Passwords'],
  ['zeroed AAGUID falls back to UA', ZERO_AAGUID, MAC_CHROME_UA, 'Chrome on macOS'],
  ['null AAGUID falls back to UA', null, MAC_CHROME_UA, 'Chrome on macOS'],
  ['no AAGUID and no UA', null, '', 'This device'],
];

describe('aaguidFromAttestationObject / defaultPasskeyName — default naming', () => {
  it('extracts the AAGUID from a valid attestation, returning null for malformed input', () => {
    for (const [label, input, expected] of EXTRACTION) {
      expect(aaguidFromAttestationObject(input), label).to.equal(expected);
    }
  });

  it('resolves the default passkey name from the vendored catalog, falling back to the UA and then to a generic label', () => {
    for (const [label, aaguid, ua, expected] of NAMING) {
      expect(defaultPasskeyName(aaguid, ua), label).to.equal(expected);
    }
  });
});
