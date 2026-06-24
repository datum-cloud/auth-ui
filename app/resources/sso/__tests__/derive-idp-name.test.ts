// Unit tests for deriveIdpProfileName — the GitHub (and general IdP) name fallback that
// guarantees non-empty profile.givenName/familyName for addHumanUser. Mirrors the old
// login app's fallback chain: IdP names → displayName split → idpUserName → "user".
import { deriveIdpProfileName } from '@/resources/sso/derive-idp-name';
import { describe, it, expect } from 'vitest';

describe('deriveIdpProfileName', () => {
  it('passes through given/family names unchanged when both are present', () => {
    expect(
      deriveIdpProfileName({
        firstName: 'Ada',
        lastName: 'Lovelace',
        displayName: 'Should Be Ignored',
        idpUserName: 'ada',
      })
    ).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
  });

  it('falls back to idpUserName for BOTH names when the draft has no name at all (GitHub)', () => {
    // GitHub commonly returns only the login (no givenName/familyName/displayName).
    expect(deriveIdpProfileName({ idpUserName: 'anindia0703' })).toEqual({
      firstName: 'anindia0703',
      lastName: 'anindia0703',
    });
  });

  it('caps the idpUserName fallback at 200 runes for both names', () => {
    const long = 'a'.repeat(250);
    const result = deriveIdpProfileName({ idpUserName: long });
    expect(result.firstName).toBe('a'.repeat(200));
    expect(result.lastName).toBe('a'.repeat(200));
  });

  it('derives given = first token and family = the rest from a displayName when names are empty', () => {
    expect(
      deriveIdpProfileName({ displayName: 'Grace Brewster Hopper', idpUserName: 'grace' })
    ).toEqual({ firstName: 'Grace Brewster', lastName: 'Hopper' });
  });

  it('uses the displayName split only when given OR family is missing', () => {
    // firstName present but lastName empty → split fills both from displayName.
    expect(
      deriveIdpProfileName({ firstName: 'X', displayName: 'Jane Q Public', idpUserName: 'jane' })
    ).toEqual({ firstName: 'Jane Q', lastName: 'Public' });
  });

  it('skips the split for a single-token displayName and falls back to idpUserName', () => {
    expect(deriveIdpProfileName({ displayName: 'Cher', idpUserName: 'cher_login' })).toEqual({
      firstName: 'cher_login',
      lastName: 'cher_login',
    });
  });

  it('treats whitespace-only names as empty and falls back to idpUserName', () => {
    expect(
      deriveIdpProfileName({ firstName: '   ', lastName: '\t', idpUserName: 'octocat' })
    ).toEqual({ firstName: 'octocat', lastName: 'octocat' });
  });

  it('trims surrounding whitespace from provided names', () => {
    expect(deriveIdpProfileName({ firstName: '  Ada  ', lastName: ' Lovelace ' })).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });

  it('falls back to "user" when no name and no idpUserName are available', () => {
    expect(deriveIdpProfileName({})).toEqual({ firstName: 'user', lastName: 'user' });
    expect(deriveIdpProfileName({ idpUserName: '   ' })).toEqual({
      firstName: 'user',
      lastName: 'user',
    });
  });
});
