import { checkA11y } from '../support/a11y';

// axe / WCAG 2.2 AA per-screen gate (INDEX §C, CCD-5)

// Deterministic fake codes: sendPasswordReset(u1) issues `reset-u1`.
describe('password reset → new password', () => {
  it('requests a reset (enumeration-safe) and sets a new password', () => {
    cy.visit('/id/password/reset');
    checkA11y(); // /password/reset
    cy.get('input[name=loginName]').type('alice@acme.test');
    cy.get('form').submit();
    cy.contains(/check your email/i); // generic, enumeration-safe (same for known + unknown)

    // Arrive from the emailed link with the deterministic reset code.
    cy.visit('/id/password/new?code=reset-u1&userId=u1');
    checkA11y(); // /password/new
    cy.get('input[name=password]').type('NewPw123!');
    cy.get('input[name=confirm]').type('NewPw123!');
    cy.get('form').submit();
    cy.location('pathname').should('include', '/login');
  });
});
