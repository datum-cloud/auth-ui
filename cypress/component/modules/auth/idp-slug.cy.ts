// cypress/component/modules/auth/idp-slug.cy.ts
//
// Component (no-mount) port of app/modules/auth/__tests__/idp-slug.test.ts.
// Pure mapping logic (browser-safe) — runs directly in the spec bundle.
import { idpTypeToSlug, slugToProvider } from '@/modules/auth/idp-slug';
import type { IdProvider } from '@/modules/auth/types';

const google: IdProvider = { id: 'idp-g', name: 'Google', type: 'GOOGLE' };
const github: IdProvider = { id: 'idp-h', name: 'GitHub', type: 'GITHUB' };

describe('idp-slug', () => {
  it('maps provider types to slugs (and null for unsupported types), and resolves providers from slugs', () => {
    expect(idpTypeToSlug('GOOGLE')).to.equal('google');
    expect(idpTypeToSlug('GITHUB')).to.equal('github');
    expect(idpTypeToSlug('APPLE')).to.be.null;
    expect(slugToProvider('google', [google, github])).to.deep.equal(google);
    expect(slugToProvider('apple', [google, github])).to.be.null;
  });
});
