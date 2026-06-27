// cypress/component/resources/shared/lifetimes.cy.ts
//
// Component (no-mount) port of app/resources/shared/__tests__/lifetimes.test.ts.
// Pure freshness-window helpers → browser-side Chai only.
import type { Factors } from '@/modules/auth/types';
import {
  isFactorFresh,
  passwordlessPasskeyFresh,
  primaryFresh,
  secondFactorFresh,
} from '@/resources/shared/lifetimes';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const at = (iso: string | null) => ({ verifiedAt: iso === null ? null : new Date(iso) });

describe('isFactorFresh', () => {
  it('is false when verifiedAt is null', () => {
    expect(isFactorFresh(at(null), T0, 1000)).to.equal(false);
  });
  it('is true (no expiry) when lifetimeMs is undefined', () => {
    expect(isFactorFresh(at('2020-01-01T00:00:00Z'), T0, undefined)).to.equal(true);
  });
  it('is true (no expiry) when lifetimeMs is 0', () => {
    expect(isFactorFresh(at('2020-01-01T00:00:00Z'), T0, 0)).to.equal(true);
  });
  it('is true inside the window', () => {
    expect(isFactorFresh(at('2026-01-01T00:00:00.000Z'), T0 + 500, 1000)).to.equal(true);
  });
  it('is true exactly at the boundary (<= is inclusive)', () => {
    expect(isFactorFresh(at('2026-01-01T00:00:00.000Z'), T0 + 1000, 1000)).to.equal(true);
  });
  it('is false just past the boundary', () => {
    expect(isFactorFresh(at('2026-01-01T00:00:00.000Z'), T0 + 1001, 1000)).to.equal(false);
  });
  it('is false for an unparseable timestamp', () => {
    expect(isFactorFresh(at('not-a-date'), T0, 1000)).to.equal(false);
  });
});

describe('primaryFresh / secondFactorFresh / passwordlessPasskeyFresh', () => {
  const fresh = '2026-01-01T00:00:00.000Z';
  it('primaryFresh true if any of password/passkey/idp is fresh', () => {
    const f: Factors = { password: at(fresh) };
    expect(primaryFresh(f, T0 + 100, 1000)).to.equal(true);
    expect(primaryFresh({ idpIntent: at(fresh) }, T0 + 100, 1000)).to.equal(true);
    expect(primaryFresh({}, T0 + 100, 1000)).to.equal(false);
  });
  it('secondFactorFresh true if any of totp/otpEmail/otpSms/u2f is fresh', () => {
    expect(secondFactorFresh({ totp: at(fresh) }, T0 + 100, 1000)).to.equal(true);
    expect(secondFactorFresh({ u2f: at(fresh) }, T0 + 100, 1000)).to.equal(true);
    expect(secondFactorFresh({ password: at(fresh) }, T0 + 100, 1000)).to.equal(false);
    expect(secondFactorFresh({ totp: at(fresh) }, T0 + 2000, 1000)).to.equal(false);
  });
  it('passwordlessPasskeyFresh requires userVerified AND fresh passkey', () => {
    expect(passwordlessPasskeyFresh({ passkey: at(fresh) }, false, T0 + 100, 1000)).to.equal(false);
    expect(passwordlessPasskeyFresh({ passkey: at(fresh) }, true, T0 + 100, 1000)).to.equal(true);
    expect(passwordlessPasskeyFresh({ passkey: at(fresh) }, true, T0 + 2000, 1000)).to.equal(false);
    expect(passwordlessPasskeyFresh({}, true, T0 + 100, 1000)).to.equal(false);
  });
});
