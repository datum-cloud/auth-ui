// cypress/component/resources/sso/idp-buttons.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/idp-buttons.test.ts.
// shouldShowIdpButtons / shouldAutoStartSingleIdp are pure predicates → browser-side Chai.
import type { IdProvider } from '@/modules/auth/types';
import { shouldShowIdpButtons, shouldAutoStartSingleIdp } from '@/resources/sso/idp-buttons';

const google: IdProvider = { id: 'idp-1', name: 'Google', type: 'GOOGLE' };

describe('shouldShowIdpButtons', () => {
  it('returns true when externalIdp capability is on and idps present', () => {
    expect(shouldShowIdpButtons({ externalIdp: true }, [google])).to.equal(true);
  });
});

describe('shouldAutoStartSingleIdp', () => {
  it('returns true for exactly one IdP with password disabled, false when password is allowed', () => {
    expect(shouldAutoStartSingleIdp([google], { allowPassword: false })).to.equal(true);
    expect(shouldAutoStartSingleIdp([google], { allowPassword: true })).to.equal(false);
  });
});
