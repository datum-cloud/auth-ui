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

describe('aaguidFromAttestationObject / defaultPasskeyName — default naming', () => {
  it('decodes a known AAGUID and maps it to the vendored catalog name', () => {
    // fbfc3007-154e-4ecc-8c0b-6e020557d7bd — Apple's authenticator (named
    // 'Apple Passwords' in the vendored catalog snapshot, upstream 9e867bf).
    const att = attestationObject(authDataWith(0x45, 'fbfc3007154e4ecc8c0b6e020557d7bd'));
    expect(aaguidFromAttestationObject(att)).to.equal('fbfc3007-154e-4ecc-8c0b-6e020557d7bd');
    expect(defaultPasskeyName('fbfc3007-154e-4ecc-8c0b-6e020557d7bd', MAC_CHROME_UA)).to.equal(
      'Apple Passwords'
    );
  });

  it('returns the zero UUID for a zeroed AAGUID and falls back to the UA name', () => {
    const att = attestationObject(authDataWith(0x45, '00000000000000000000000000000000'));
    expect(aaguidFromAttestationObject(att)).to.equal('00000000-0000-0000-0000-000000000000');
    expect(defaultPasskeyName('00000000-0000-0000-0000-000000000000', MAC_CHROME_UA)).to.equal(
      'Chrome on macOS'
    );
  });

  it('never throws on garbage input — returns null and the UA fallback (AAGUID failure never blocks enrollment)', () => {
    expect(aaguidFromAttestationObject('!!!')).to.equal(null);
    expect(aaguidFromAttestationObject('')).to.equal(null);
    // truncated CBOR: a map header promising entries that never arrive
    expect(aaguidFromAttestationObject('owFj')).to.equal(null);
    expect(defaultPasskeyName(null, MAC_CHROME_UA)).to.equal('Chrome on macOS');
    expect(defaultPasskeyName(null, '')).to.equal('This device');
  });

  it('returns null when the AT flag is absent (no attested credential data)', () => {
    const att = attestationObject(authDataWith(0x01)); // UP only, no AT, no AAGUID bytes
    expect(aaguidFromAttestationObject(att)).to.equal(null);
  });
});
