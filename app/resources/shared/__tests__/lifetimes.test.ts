import {
  isFactorFresh,
  primaryFresh,
  secondFactorFresh,
  passwordlessPasskeyFresh,
} from '../lifetimes';
import type { Factors } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
// verifiedAt is `Date | null`. 'not-a-date' yields an Invalid Date (getTime() ⇒ NaN),
// which isFactorFresh treats as not fresh.
const at = (iso: string | null) => ({ verifiedAt: iso === null ? null : new Date(iso) });

describe('isFactorFresh', () => {
  it('is false when verifiedAt is null', () => {
    expect(isFactorFresh(at(null), T0, 1000)).toBe(false);
  });
  it('is true (no expiry) when lifetimeMs is undefined', () => {
    expect(isFactorFresh(at('2020-01-01T00:00:00Z'), T0, undefined)).toBe(true);
  });
  it('is true (no expiry) when lifetimeMs is 0', () => {
    expect(isFactorFresh(at('2020-01-01T00:00:00Z'), T0, 0)).toBe(true);
  });
  it('is true inside the window', () => {
    expect(isFactorFresh(at('2026-01-01T00:00:00.000Z'), T0 + 500, 1000)).toBe(true);
  });
  it('is true exactly at the boundary (<= is inclusive)', () => {
    expect(isFactorFresh(at('2026-01-01T00:00:00.000Z'), T0 + 1000, 1000)).toBe(true);
  });
  it('is false just past the boundary', () => {
    expect(isFactorFresh(at('2026-01-01T00:00:00.000Z'), T0 + 1001, 1000)).toBe(false);
  });
  it('is false for an unparseable timestamp', () => {
    expect(isFactorFresh(at('not-a-date'), T0, 1000)).toBe(false);
  });
});

describe('primaryFresh / secondFactorFresh / passwordlessPasskeyFresh', () => {
  const fresh = '2026-01-01T00:00:00.000Z';
  it('primaryFresh true if any of password/passkey/idp is fresh', () => {
    const f: Factors = { password: at(fresh) };
    expect(primaryFresh(f, T0 + 100, 1000)).toBe(true);
    expect(primaryFresh({ idpIntent: at(fresh) }, T0 + 100, 1000)).toBe(true);
    expect(primaryFresh({}, T0 + 100, 1000)).toBe(false);
  });
  it('secondFactorFresh true if any of totp/otpEmail/otpSms/u2f is fresh', () => {
    expect(secondFactorFresh({ totp: at(fresh) }, T0 + 100, 1000)).toBe(true);
    expect(secondFactorFresh({ u2f: at(fresh) }, T0 + 100, 1000)).toBe(true);
    expect(secondFactorFresh({ password: at(fresh) }, T0 + 100, 1000)).toBe(false);
    expect(secondFactorFresh({ totp: at(fresh) }, T0 + 2000, 1000)).toBe(false); // stale
  });
  it('passwordlessPasskeyFresh requires userVerified AND fresh passkey', () => {
    expect(passwordlessPasskeyFresh({ passkey: at(fresh) }, false, T0 + 100, 1000)).toBe(false); // not user-verified
    expect(passwordlessPasskeyFresh({ passkey: at(fresh) }, true, T0 + 100, 1000)).toBe(true);
    expect(passwordlessPasskeyFresh({ passkey: at(fresh) }, true, T0 + 2000, 1000)).toBe(false); // stale
    expect(passwordlessPasskeyFresh({}, true, T0 + 100, 1000)).toBe(false);
  });
});
