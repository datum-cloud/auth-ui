// cypress/component/resources/sso/derive-idp-name.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/derive-idp-name.test.ts.
// deriveIdpProfileName is pure (string fallback chain) → runs browser-side with Chai.
import { deriveIdpProfileName } from '@/resources/sso/derive-idp-name';

describe('deriveIdpProfileName', () => {
  it('passes through given/family names unchanged when both are present', () => {
    expect(
      deriveIdpProfileName({
        firstName: 'Ada',
        lastName: 'Lovelace',
        displayName: 'Should Be Ignored',
        idpUserName: 'ada',
      })
    ).to.deep.equal({ firstName: 'Ada', lastName: 'Lovelace' });
  });

  it('falls back to idpUserName for BOTH names when the draft has no name at all (GitHub)', () => {
    expect(deriveIdpProfileName({ idpUserName: 'anindia0703' })).to.deep.equal({
      firstName: 'anindia0703',
      lastName: 'anindia0703',
    });
  });

  it('falls back to "user" when no name and no idpUserName are available', () => {
    expect(deriveIdpProfileName({})).to.deep.equal({ firstName: 'user', lastName: 'user' });
    expect(deriveIdpProfileName({ idpUserName: '   ' })).to.deep.equal({
      firstName: 'user',
      lastName: 'user',
    });
  });
});
