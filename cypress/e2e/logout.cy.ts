import { checkA11y } from '../support/a11y';

describe('logout journey', () => {
  it('signs out, lands on /logout/success, and clears the session', () => {
    // --- 1. Sign in as alice ---
    cy.visit('/id/login');
    cy.get('input[name="loginName"]').type('alice@acme.test');
    // /login now renders 3 forms (identifier + 2 IdP buttons, Phase 4) — scope to the entry form.
    cy.get('input[name="loginName"]:visible').closest('form').submit();

    cy.location('pathname').should('eq', '/id/login/password');
    cy.get('input[name="password"]').type('hunter2');
    cy.get('form').submit();

    cy.location('pathname').should('eq', '/id/signed-in');
    cy.contains('alice@acme.test');

    // --- 2. Submit the sign-out form ---
    cy.get('form[action="/id/logout"]').submit();

    // --- 3. Assert landing on /logout/success ---
    cy.location('pathname').should('eq', '/id/logout/success');
    cy.contains("You've been signed out");
    checkA11y();

    // --- 4. Re-visit /signed-in and assert signed-out state ---
    // signed-in.tsx loader returns { loginName: null } when the cookie is empty;
    // the component renders without any loginName text (or redirects — match either).
    cy.visit('/id/signed-in');
    // The page should not display alice's loginName (session was cleared)
    cy.contains('alice@acme.test').should('not.exist');
  });
});
