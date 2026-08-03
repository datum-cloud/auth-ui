import { SignOutButton } from '@/components/sign-out-button/sign-out-button';

// The datum-ui Button does not render a `data-theme` attribute — its `theme`/`type` props
// are compiled to Tailwind utility classes only (confirmed by mounting Button directly and
// inspecting outerHTML: theme="solid" + type="primary" emits a class containing
// "bg-btn-primary"; theme="link" + type="secondary" emits a class containing "underline",
// with no compound-variant overlap between the two). Assert on those classes instead.
describe('SignOutButton', () => {
  it('posts to /id/logout?index with CSRF, defaulting to the link treatment', () => {
    cy.mount(<SignOutButton csrf="tok-1" />);
    cy.get('form').should('have.attr', 'action', '/id/logout?index');
    cy.get('input[name="csrf"]').should('have.value', 'tok-1');
    cy.contains('button', 'Sign out')
      .invoke('attr', 'class')
      .should('include', 'underline')
      .and('not.include', 'bg-btn-primary');

    cy.mount(<SignOutButton csrf="tok-1" emphasis="primary" />);
    cy.contains('button', 'Sign out')
      .invoke('attr', 'class')
      .should('include', 'bg-btn-primary')
      .and('not.include', 'underline');
  });
});
