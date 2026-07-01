// cypress/component/resources/login/login-decision.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/login-decision.test.ts.
// decideAfterIdentifier is a pure routing function → browser-side Chai only.
import type { LoginSettings } from '@/modules/auth/types';
import { decideAfterIdentifier } from '@/resources/login/login-decision';

const PRIMARY = { role: 'primary' } as const;

describe('decideAfterIdentifier → discriminated Decision union', () => {
  it('does NOT route to /sso when allowExternalIdp is false (policy gate)', () => {
    const d = decideAfterIdentifier({
      methods: ['idp', 'password'],
      settings: {
        allowPassword: true,
        allowExternalIdp: false,
        passkeysType: 'not_allowed',
      } as LoginSettings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/login/password' });
  });

  it('routes to /sso when allowExternalIdp is true and idp is enrolled', () => {
    const d = decideAfterIdentifier({
      methods: ['idp'],
      settings: {
        allowPassword: true,
        allowExternalIdp: true,
        passkeysType: 'not_allowed',
      } as LoginSettings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/sso' });
  });
});
