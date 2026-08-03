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
  const factors: Factors = { password: { verifiedAt: new Date('2026-01-01T00:00:00Z') } };

  it('routes to /signed-in when MFA is not forced, and to /setup/mfa?force=true when it is', () => {
    expect(nextStep({ factors, settings, nowMs: NOW }), 'not forced').to.equal('/signed-in');

    const forced = nextStep({
      factors,
      settings: { ...settings, forceMfa: true },
      nowMs: NOW,
      enrolledMethods: [],
      loginName: '',
      userVerified: false,
      mfaInitSkippedAt: null,
    });
    expect(forced, 'forced: path').to.contain('/setup/mfa');
    expect(forced, 'forced: force flag').to.contain('force=true');
    expect(forced, 'forced: checkAfter flag').to.contain('checkAfter=true');
  });
});
