import { IdentityBadge } from '@/components/identity-badge/identity-badge';

describe('IdentityBadge', () => {
  it('shows the login name and a "Not you?" link to /login', () => {
    cy.mount(<IdentityBadge loginName="alice@acme.test" />);
    cy.contains('alice@acme.test').should('exist');
    cy.findByRole('link', { name: /not you/i }).should('have.attr', 'href', '/login');
  });

  it('preserves requestId + organization but NOT loginName on the link', () => {
    cy.mount(
      <IdentityBadge loginName="alice@acme.test" requestId="oidc_abc" organization="org-1" />
    );
    cy.findByRole('link', { name: /not you/i })
      .should('have.attr', 'href')
      .and('include', '/login?')
      .and('include', 'requestId=oidc_abc')
      .and('include', 'organization=org-1')
      .and('not.include', 'loginName');
  });

  it('renders nothing without a loginName', () => {
    cy.mount(<IdentityBadge loginName="" />);
    // IdentityBadge returns null — no <p> or link should be present.
    cy.get('p').should('not.exist');
    cy.get('a').should('not.exist');
  });
});
