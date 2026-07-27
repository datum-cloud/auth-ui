// cypress/component/resources/shared/sudo.cy.ts
//
// NO-MOUNT: pure-function assertions for the sudo-freshness window.
import { isSudoFresh, SUDO_TTL_MS } from '@/resources/shared/sudo';

const at = (iso: string) => ({ verifiedAt: new Date(iso) });
const NOW = Date.parse('2026-07-17T12:00:00Z');

describe('isSudoFresh — 10-minute authentication-factor window', () => {
  it('accepts each authentication factor at exactly the TTL boundary', () => {
    const edge = at(new Date(NOW - SUDO_TTL_MS).toISOString());
    for (const key of [
      'password',
      'passkey',
      'u2f',
      'totp',
      'otpEmail',
      'otpSms',
      'idpIntent',
    ] as const) {
      expect(isSudoFresh({ [key]: edge }, NOW), key).to.equal(true);
    }
  });
  it('rejects a factor 1ms past the window, unverified factors, and the empty factor set', () => {
    expect(
      isSudoFresh({ password: at(new Date(NOW - SUDO_TTL_MS - 1).toISOString()) }, NOW)
    ).to.equal(false);
    expect(isSudoFresh({ password: { verifiedAt: null } }, NOW)).to.equal(false);
    expect(isSudoFresh({}, NOW)).to.equal(false); // bare user check ⇒ no Factors entry ⇒ never sudo
  });
});
