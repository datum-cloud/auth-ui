import { checkA11y } from '../support/a11y';

// NOTE: The /password/change loader resolves the active ceremony session from the
// signed cookie via mostRecent(). In the Cypress fake-provider environment there is
// no way to pre-seed a live session cookie, so the loader returns sessionId: '' and
// loginName: ''. The form still renders (empty sessionId is accepted by the schema
// at parse time; the server action would reject it on byId lookup with SESSION_EXPIRED).
// This spec therefore validates:
//   1. The page renders at all (AuthCard shell + form inputs visible).
//   2. The page passes axe / WCAG 2.2 AA with the AuthCard layout.
describe('/password/change', () => {
  it('renders the change-password form and passes a11y', () => {
    cy.visit('/id/password/change');
    // Password input must be visible (Form.Root rendered inside AuthCard)
    cy.get('input[name=password]:visible').should('exist');
    cy.get('input[name=confirm]:visible').should('exist');
    checkA11y();
  });
});
