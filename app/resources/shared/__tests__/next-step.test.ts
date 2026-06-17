import { nextStep } from '../next-step';
import type { Factors, LoginSettings } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

const settings: LoginSettings = {
  allowPassword: true,
  allowRegister: true,
  allowExternalIdp: true,
  passkeysType: 'allowed',
  forceMfa: false,
};

const NOW = Date.parse('2026-01-01T00:00:00Z'); // injected clock — flows never read Date.now()
const T0 = Date.parse('2026-01-01T00:00:00.000Z');

describe('nextStep', () => {
  it('routes to /signed-in when password is verified and no MFA is forced', () => {
    const factors: Factors = { password: { verifiedAt: '2026-01-01T00:00:00Z' } };
    expect(nextStep({ factors, settings, nowMs: NOW })).toBe('/signed-in');
  });
  it('routes to /setup/mfa?force=true&checkAfter=true when MFA is forced but no 2nd factor is enrolled', () => {
    // P5: no enrolled methods + forceMfa → setup screen with force+checkAfter baked in.
    const factors: Factors = { password: { verifiedAt: '2026-01-01T00:00:00Z' } };
    const result = nextStep({
      factors,
      settings: { ...settings, forceMfa: true },
      nowMs: NOW,
      enrolledMethods: [],
      loginName: '',
      userVerified: false,
      mfaInitSkippedAt: null,
    });
    expect(result).toContain('/setup/mfa');
    expect(result).toContain('force=true');
    expect(result).toContain('checkAfter=true');
  });
  it('routes to /login/password when nothing is verified yet', () => {
    expect(nextStep({ factors: {}, settings, nowMs: NOW })).toBe('/login/password');
  });
  it('routes to /signed-in when passkey is primary-verified and no MFA is forced', () => {
    const factors: Factors = { passkey: { verifiedAt: '2026-01-01T00:00:00Z' } };
    expect(nextStep({ factors, settings, nowMs: NOW })).toBe('/signed-in');
  });
  it('routes to /signed-in when MFA is forced and a second factor is verified', () => {
    const factors: Factors = {
      password: { verifiedAt: '2026-01-01T00:00:00Z' },
      totp: { verifiedAt: '2026-01-01T00:00:00Z' },
    };
    expect(nextStep({ factors, settings: { ...settings, forceMfa: true }, nowMs: NOW })).toBe(
      '/signed-in'
    );
  });
});

// ── Phase 5 MFA composition cases ────────────────────────────────────────────

describe('nextStep — P5 MFA composition', () => {
  it('after password, routes to the single enrolled 2nd factor', () => {
    const factors: Factors = { password: { verifiedAt: '2026-01-01T00:00:00Z' } };
    expect(
      nextStep({
        factors,
        settings,
        enrolledMethods: ['totp'],
        nowMs: T0 + 100,
        loginName: 'a@acme.test',
        userVerified: false,
        mfaInitSkippedAt: null,
      })
    ).toContain('/login/verify/authenticator');
  });

  it('after password with a fresh 2nd factor, routes to /signed-in', () => {
    const factors: Factors = {
      password: { verifiedAt: '2026-01-01T00:00:00Z' },
      totp: { verifiedAt: '2026-01-01T00:00:00Z' },
    };
    expect(
      nextStep({
        factors,
        settings: { ...settings, secondFactorCheckLifetimeMs: 10_000 },
        enrolledMethods: ['totp'],
        nowMs: T0 + 100,
        loginName: 'a@acme.test',
        userVerified: false,
        mfaInitSkippedAt: null,
      })
    ).toBe('/signed-in');
  });

  it('forced MFA with no 2nd factor routes to /setup/mfa with force=true&checkAfter=true', () => {
    const factors: Factors = { password: { verifiedAt: '2026-01-01T00:00:00Z' } };
    const result = nextStep({
      factors,
      settings: { ...settings, forceMfa: true },
      enrolledMethods: [],
      nowMs: T0 + 100,
      loginName: 'a@acme.test',
      userVerified: false,
      mfaInitSkippedAt: null,
    });
    expect(result).toContain('/setup/mfa');
    expect(result).toContain('force=true');
    expect(result).toContain('checkAfter=true');
  });

  it('nextStep retains ceremony params when called directly (CODE-MIN-10)', () => {
    // Primary fresh, TOTP enrolled but not yet verified → routes to MFA verify screen.
    // The contract: a direct nextStep caller that passes loginName gets it back in the URL.
    const factors: Factors = { password: { verifiedAt: '2026-01-01T00:00:00Z' } };
    const target = nextStep({
      factors,
      settings,
      enrolledMethods: ['totp'],
      loginName: 'alice@acme.test',
      nowMs: T0 + 100,
      userVerified: false,
      mfaInitSkippedAt: null,
    });
    expect(target).toContain('loginName=alice%40acme.test');
  });
});
