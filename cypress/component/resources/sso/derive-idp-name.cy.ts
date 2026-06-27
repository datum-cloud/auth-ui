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

  it('caps the idpUserName fallback at 200 runes for both names', () => {
    const long = 'a'.repeat(250);
    const result = deriveIdpProfileName({ idpUserName: long });
    expect(result.firstName).to.equal('a'.repeat(200));
    expect(result.lastName).to.equal('a'.repeat(200));
  });

  it('derives given = first token and family = the rest from a displayName when names are empty', () => {
    expect(
      deriveIdpProfileName({ displayName: 'Grace Brewster Hopper', idpUserName: 'grace' })
    ).to.deep.equal({ firstName: 'Grace Brewster', lastName: 'Hopper' });
  });

  it('uses the displayName split only when given OR family is missing', () => {
    expect(
      deriveIdpProfileName({ firstName: 'X', displayName: 'Jane Q Public', idpUserName: 'jane' })
    ).to.deep.equal({ firstName: 'Jane Q', lastName: 'Public' });
  });

  it('skips the split for a single-token displayName and falls back to idpUserName', () => {
    expect(deriveIdpProfileName({ displayName: 'Cher', idpUserName: 'cher_login' })).to.deep.equal({
      firstName: 'cher_login',
      lastName: 'cher_login',
    });
  });

  it('treats whitespace-only names as empty and falls back to idpUserName', () => {
    expect(
      deriveIdpProfileName({ firstName: '   ', lastName: '\t', idpUserName: 'octocat' })
    ).to.deep.equal({ firstName: 'octocat', lastName: 'octocat' });
  });

  it('trims surrounding whitespace from provided names', () => {
    expect(deriveIdpProfileName({ firstName: '  Ada  ', lastName: ' Lovelace ' })).to.deep.equal({
      firstName: 'Ada',
      lastName: 'Lovelace',
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
