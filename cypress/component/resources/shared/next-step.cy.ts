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
});
