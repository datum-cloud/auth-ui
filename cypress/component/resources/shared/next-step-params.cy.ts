// cypress/component/resources/shared/next-step-params.cy.ts
//
// Component (no-mount) port of app/resources/shared/__tests__/next-step-params.test.ts.
// Pure routing helpers (authorizeHandbackTarget, nextStepWithParams, nextStepFromSession)
// → browser-side Chai only.
import type { Factors, LoginSettings, Session } from '@/modules/auth/types';
import { nextStepFromSession, nextStepWithParams } from '@/resources/shared/next-step-params';

const factors = {
  password: { verifiedAt: new Date('2999-01-01T00:00:00.000Z') },
} as unknown as Factors;
const settings = {
  allowPassword: true,
  allowExternalIdp: true,
  allowRegister: false,
  passkeysType: 'not_allowed',
  passwordCheckLifetimeMs: undefined,
  forceMfa: false,
  forceMfaLocalOnly: false,
} as unknown as LoginSettings;

describe('nextStepWithParams requestId validation', () => {
  it('drops a requestId that fails the prefix allowlist', () => {
    const url = nextStepWithParams({ factors, settings, requestId: 'evil://x' });
    expect(url).not.to.contain('requestId');
  });
});

describe('nextStepFromSession (shared assembly)', () => {
  it('derives userVerified=true from the session passkey factor (passwordless shortcut)', () => {
    const passwordlessFactors = {
      passkey: { verifiedAt: new Date('2999-01-01T00:00:00.000Z'), userVerified: true },
    } as unknown as Factors;
    const session = {
      factors: passwordlessFactors,
      user: { id: 'u1', loginName: 'a@x.test' },
    } as unknown as Session;
    const url = nextStepFromSession({
      session,
      methods: [],
      settings,
      loginName: 'a@x.test',
      mfaInitSkippedAt: null,
    });
    expect(url).to.contain('/signed-in');
  });
});
