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

  it('supports a custom verb, link label, and link target (defaults unchanged)', () => {
    cy.mount(
      <IdentityBadge
        loginName="bob@acme.test"
        verb="Signing up as"
        linkLabel="Not you?"
        linkTarget="/signup?requestId=oidc_z"
      />
    );
    cy.contains('Signing up as').should('exist');
    cy.contains('bob@acme.test').should('exist');
    cy.findByRole('link', { name: /not you/i }).should(
      'have.attr',
      'href',
      '/signup?requestId=oidc_z'
    );
  });

  it('renders no link at all when showLink is false', () => {
    cy.mount(<IdentityBadge loginName="carol@acme.test" verb="Sign out of" showLink={false} />);
    cy.contains('Sign out of').should('exist');
    cy.contains('carol@acme.test').should('exist');
    cy.get('a').should('not.exist');
  });
});
