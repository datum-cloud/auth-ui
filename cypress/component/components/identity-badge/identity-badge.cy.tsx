import { IdentityBadge } from '@/components/identity-badge/identity-badge';

describe('IdentityBadge', () => {
  it('shows the login name + "Not you?" link preserving requestId/organization (not loginName), and renders nothing without a loginName', () => {
    cy.mount(
      <IdentityBadge loginName="alice@acme.test" requestId="oidc_abc" organization="org-1" />
    );
    cy.contains('alice@acme.test').should('exist');
    cy.findByRole('link', { name: /not you/i })
      .should('have.attr', 'href')
      .and('include', '/login?')
      .and('include', 'requestId=oidc_abc')
      .and('include', 'organization=org-1')
      .and('not.include', 'loginName');

    cy.mount(<IdentityBadge loginName="" />);
    // IdentityBadge returns null — no <p> or link should be present.
    cy.get('p').should('not.exist');
    cy.get('a').should('not.exist');
  });
});
