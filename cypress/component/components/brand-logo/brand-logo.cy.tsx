// cypress/component/components/brand-logo/brand-logo.cy.tsx
//
// BrandLogo renders on nearly every ceremony route (/, /login, /signup, /setup/*, ...). Its home
// link used to be a hardcoded `to="/"`, silently dropping any in-flight requestId/organization —
// clicking the logo mid-OIDC/SAML/device ceremony dead-ended the flow. It now reads them off the
// CURRENT URL (useSearchParams) and carries them onto the link.
import { BrandLogo } from '@/components/brand-logo/brand-logo';

describe('BrandLogo — preserves the ceremony on its home link', () => {
  it('carries ceremony params from the current URL onto the home link', () => {
    const rows = [
      {
        label: 'requestId + organization carried onto the home link',
        entry: '/login?requestId=oidc_V2_123&organization=org-1',
        expectedHref: '/?requestId=oidc_V2_123&organization=org-1',
      },
      {
        label: 'requestId alone (organization omitted) without a stray param',
        entry: '/login?requestId=saml_abc',
        expectedHref: '/?requestId=saml_abc',
      },
      {
        label: 'no ceremony params (bare /login) degrades to a bare "/"',
        entry: '/login',
        expectedHref: '/',
      },
    ] as const;

    rows.forEach((row) => {
      cy.mount(<BrandLogo />, { path: '/login', initialEntries: [row.entry] });
      cy.get('a').should(($a) => {
        expect($a.attr('href'), row.label).to.equal(row.expectedHref);
      });
    });
  });
});
