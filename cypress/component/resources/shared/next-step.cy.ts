// cypress/component/resources/shared/next-step.cy.ts
//
// Component (no-mount) port of app/resources/shared/__tests__/next-step.test.ts.
// Pure routing function (nextStep) → browser-side Chai only.
import type { Factors, LoginSettings } from '@/modules/auth/types';
import { nextStep } from '@/resources/shared/next-step';

const settings: LoginSettings = {
  allowPassword: true,
  allowRegister: true,
  allowExternalIdp: true,
  passkeysType: 'allowed',
  forceMfa: false,
};

const NOW = Date.parse('2026-01-01T00:00:00Z');
const T0 = Date.parse('2026-01-01T00:00:00.000Z');

describe('nextStep', () => {
  it('routes to /signed-in when password is verified and no MFA is forced', () => {
    const factors: Factors = { password: { verifiedAt: new Date('2026-01-01T00:00:00Z') } };
    expect(nextStep({ factors, settings, nowMs: NOW })).to.equal('/signed-in');
  });
  it('routes to /setup/mfa?force=true&checkAfter=true when MFA is forced but no 2nd factor is enrolled', () => {
    const factors: Factors = { password: { verifiedAt: new Date('2026-01-01T00:00:00Z') } };
    const result = nextStep({
      factors,
      settings: { ...settings, forceMfa: true },
      nowMs: NOW,
      enrolledMethods: [],
      loginName: '',
      userVerified: false,
      mfaInitSkippedAt: null,
    });
    expect(result).to.contain('/setup/mfa');
    expect(result).to.contain('force=true');
    expect(result).to.contain('checkAfter=true');
  });
  it('routes to /login/password when nothing is verified yet', () => {
    expect(nextStep({ factors: {}, settings, nowMs: NOW })).to.equal('/login/password');
  });
  it('routes to /signed-in when passkey is primary-verified and no MFA is forced', () => {
    const factors: Factors = { passkey: { verifiedAt: new Date('2026-01-01T00:00:00Z') } };
    expect(nextStep({ factors, settings, nowMs: NOW })).to.equal('/signed-in');
  });
  it('routes to /signed-in when MFA is forced and a second factor is verified', () => {
    const factors: Factors = {
      password: { verifiedAt: new Date('2026-01-01T00:00:00Z') },
      totp: { verifiedAt: new Date('2026-01-01T00:00:00Z') },
    };
    expect(nextStep({ factors, settings: { ...settings, forceMfa: true }, nowMs: NOW })).to.equal(
      '/signed-in'
    );
  });
});

describe('nextStep — P5 MFA composition', () => {
  it('after password, routes to the single enrolled 2nd factor', () => {
    const factors: Factors = { password: { verifiedAt: new Date('2026-01-01T00:00:00Z') } };
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
    ).to.contain('/login/verify/authenticator');
  });

  it('after password with a fresh 2nd factor, routes to /signed-in', () => {
    const factors: Factors = {
      password: { verifiedAt: new Date('2026-01-01T00:00:00Z') },
      totp: { verifiedAt: new Date('2026-01-01T00:00:00Z') },
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
    ).to.equal('/signed-in');
  });

  it('forced MFA with no 2nd factor routes to /setup/mfa with force=true&checkAfter=true', () => {
    const factors: Factors = { password: { verifiedAt: new Date('2026-01-01T00:00:00Z') } };
    const result = nextStep({
      factors,
      settings: { ...settings, forceMfa: true },
      enrolledMethods: [],
      nowMs: T0 + 100,
      loginName: 'a@acme.test',
      userVerified: false,
      mfaInitSkippedAt: null,
    });
    expect(result).to.contain('/setup/mfa');
    expect(result).to.contain('force=true');
    expect(result).to.contain('checkAfter=true');
  });

  it('nextStep retains ceremony params when called directly', () => {
    const factors: Factors = { password: { verifiedAt: new Date('2026-01-01T00:00:00Z') } };
    const target = nextStep({
      factors,
      settings,
      enrolledMethods: ['totp'],
      loginName: 'alice@acme.test',
      nowMs: T0 + 100,
      userVerified: false,
      mfaInitSkippedAt: null,
    });
    expect(target).to.contain('loginName=alice%40acme.test');
  });
});
