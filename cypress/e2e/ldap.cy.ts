import { checkA11y } from '../support/a11y';

// Rate-limit budget: ldapRateLimit allows 5 POST attempts per IP per 5-minute
// window (in-memory, resets on server restart). The dev server starts fresh for
// each `test:e2e` run, so the budget resets automatically. This spec uses
// exactly 2 POSTs (1 good + 1 bad-credentials test), well within the 5-attempt
// limit even when Cypress retries are factored in.

// ─── LDAP sign-in (/sso/ldap) ─────────────────────────────────────────────────

describe('LDAP sign-in (/sso/ldap)', () => {
  it('renders accessibly, accepts bob/pw, and redirects to /signed-in', () => {
    cy.visit('/id/sso/ldap?idpId=idp-ldap');

    checkA11y();

    cy.get('input[name="username"]').type('bob');
    cy.get('input[name="password"]').type('pw');
    cy.contains('button[type="submit"]', /sign in/i).click();

    cy.location('pathname').should('eq', '/id/signed-in');
  });

  // Second test: bad credentials. Kept as a single it-block so the total
  // POST count stays at 2 (1 good + 1 bad). Cypress does not retry passed
  // tests so there is no multiplication risk.
  it('shows an error for invalid credentials', () => {
    cy.visit('/id/sso/ldap?idpId=idp-ldap');

    cy.get('input[name="username"]').type('bob');
    cy.get('input[name="password"]').type('wrong-password');
    cy.contains('button[type="submit"]', /sign in/i).click();

    cy.contains(/invalid username or password/i).should('be.visible');
    checkA11y(); // error render is a distinct DOM state — axe it too
  });
});
