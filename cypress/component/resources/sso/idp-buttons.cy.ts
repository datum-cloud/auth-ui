// cypress/component/resources/sso/idp-buttons.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/idp-buttons.test.ts.
// shouldShowIdpButtons / shouldAutoStartSingleIdp are pure predicates → browser-side Chai.
import type { IdProvider } from '@/modules/auth/types';
import { shouldShowIdpButtons, shouldAutoStartSingleIdp } from '@/resources/sso/idp-buttons';

const google: IdProvider = { id: 'idp-1', name: 'Google', type: 'GOOGLE' };
const github: IdProvider = { id: 'idp-2', name: 'GitHub', type: 'GITHUB' };

describe('shouldShowIdpButtons', () => {
  it('returns true when externalIdp capability is on and idps present', () => {
    expect(shouldShowIdpButtons({ externalIdp: true }, [google])).to.equal(true);
  });

  it('returns false when externalIdp capability is off', () => {
    expect(shouldShowIdpButtons({ externalIdp: false }, [google])).to.equal(false);
  });

  it('returns false when idps list is empty', () => {
    expect(shouldShowIdpButtons({ externalIdp: true }, [])).to.equal(false);
  });
});

describe('shouldAutoStartSingleIdp', () => {
  it('returns true for exactly one IdP with password disabled', () => {
    expect(shouldAutoStartSingleIdp([google], { allowPassword: false })).to.equal(true);
  });

  it('returns false when password is allowed', () => {
    expect(shouldAutoStartSingleIdp([google], { allowPassword: true })).to.equal(false);
  });

  it('returns false when multiple IdPs exist', () => {
    expect(shouldAutoStartSingleIdp([google, github], { allowPassword: false })).to.equal(false);
  });

  it('returns false when idps list is empty', () => {
    expect(shouldAutoStartSingleIdp([], { allowPassword: false })).to.equal(false);
  });
});
