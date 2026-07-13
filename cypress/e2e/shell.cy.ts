import { checkA11y } from '../support/a11y';

describe('app shell', () => {
  it('renders the styled error page for unknown routes', () => {
    cy.visit('/id/this-does-not-exist', { failOnStatusCode: false });
    cy.contains('Something went wrong');
    checkA11y();
  });
});
