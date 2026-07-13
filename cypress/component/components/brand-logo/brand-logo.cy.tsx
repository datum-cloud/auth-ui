// cypress/component/components/brand-logo/brand-logo.cy.tsx
//
// BrandLogo renders on nearly every ceremony route (/, /login, /signup, /setup/*, ...). Its home
// link used to be a hardcoded `to="/"`, silently dropping any in-flight requestId/organization —
// clicking the logo mid-OIDC/SAML/device ceremony dead-ended the flow. It now reads them off the
// CURRENT URL (useSearchParams) and carries them onto the link.
import { BrandLogo } from '@/components/brand-logo/brand-logo';

describe('BrandLogo — preserves the ceremony on its home link', () => {
  it('carries requestId + organization from the current URL onto the home link', () => {
    cy.mount(<BrandLogo />, {
      path: '/login',
      initialEntries: ['/login?requestId=oidc_V2_123&organization=org-1'],
    });
    cy.get('a').should('have.attr', 'href', '/?requestId=oidc_V2_123&organization=org-1');
  });

  it('carries requestId alone (organization omitted) without a stray param', () => {
    cy.mount(<BrandLogo />, {
      path: '/login',
      initialEntries: ['/login?requestId=saml_abc'],
    });
    cy.get('a').should('have.attr', 'href', '/?requestId=saml_abc');
  });

  it('degrades to a bare "/" on a page with no ceremony params (e.g. bare /login)', () => {
    cy.mount(<BrandLogo />, { path: '/login', initialEntries: ['/login'] });
    cy.get('a').should('have.attr', 'href', '/');
  });
});
