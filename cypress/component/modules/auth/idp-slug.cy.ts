// cypress/component/modules/auth/idp-slug.cy.ts
//
// Component (no-mount) port of app/modules/auth/__tests__/idp-slug.test.ts.
// Pure mapping logic (browser-safe) — runs directly in the spec bundle.
import { idpTypeToSlug, slugToProvider } from '@/modules/auth/idp-slug';
import type { IdProvider } from '@/modules/auth/types';

const google: IdProvider = { id: 'idp-g', name: 'Google', type: 'GOOGLE' };
const github: IdProvider = { id: 'idp-h', name: 'GitHub', type: 'GITHUB' };

describe('idpTypeToSlug', () => {
  it('maps Google and GitHub provider types to slugs', () => {
    expect(idpTypeToSlug('GOOGLE')).to.equal('google');
    expect(idpTypeToSlug('GITHUB')).to.equal('github');
  });
  it('returns null for an unsupported (v1) type', () => {
    expect(idpTypeToSlug('APPLE')).to.be.null;
  });
  it('finds the active provider matching a slug', () => {
    expect(slugToProvider('google', [google, github])).to.deep.equal(google);
    expect(slugToProvider('github', [google, github])).to.deep.equal(github);
    expect(slugToProvider('apple', [google, github])).to.be.null;
  });
});
