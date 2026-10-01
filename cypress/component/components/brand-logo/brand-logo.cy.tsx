// cypress/component/components/brand-logo/brand-logo.cy.tsx
//
// BrandLogo renders on nearly every ceremony route (/, /login, /signup, /setup/*, ...) and is the
// way back to the marketing site, so it links to datum.net in the same tab — not back into auth-ui.
import { BrandLogo } from '@/components/brand-logo/brand-logo';

describe('BrandLogo — links back to datum.net', () => {
  it('links to https://www.datum.net in the same tab, even mid-ceremony', () => {
    cy.mount(<BrandLogo />, {
      path: '/login',
      initialEntries: ['/login?requestId=oidc_V2_123&organization=org-1'],
    });

    cy.get('a').should('have.attr', 'href', 'https://www.datum.net').and('not.have.attr', 'target');
  });
});
