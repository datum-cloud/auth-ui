import { checkA11y } from '../support/a11y';

// axe / WCAG 2.2 AA per-screen gate

// Callback route query params: ?id=<intentId>&token=<intentToken>
// The fake provider accepts any token for seeded intents.

describe('SSO — IdP buttons on /login', () => {
  it('renders Continue-with-Google and Continue-with-GitHub buttons', () => {
    cy.visit('/id/login');
    cy.contains('Continue with Google').should('exist');
    cy.contains('Continue with GitHub').should('exist');
    checkA11y(); // /login with IdP buttons
  });
});

describe('SSO — sign-in (existing linked user)', () => {
  it('callback for a linked user creates a session and lands signed-in', () => {
    // intent-signin has userId='u1' → decideIdpCallback returns 'sign-in'
    cy.visit('/id/sso/google/callback?id=intent-signin&token=t', {
      failOnStatusCode: false,
    });
    cy.location('pathname').should('match', /\/(id\/)?signed-in$/);
    checkA11y(); // /signed-in terminal screen
  });
});

describe('SSO — register-and-link (new IdP user)', () => {
  it('callback for a new user redirects to /signup prefilled with IdP draft data', () => {
    // intent-register has userId=null → decideIdpCallback returns 'register'
    cy.visit('/id/sso/google/callback?id=intent-register&token=t', {
      failOnStatusCode: false,
    });
    cy.location('pathname').should('include', '/signup');
    // email prefilled from draft
    cy.get('input[name=email]:visible').should('have.value', 'newbie@idp.test');
    checkA11y(); // /signup prefilled from IdP draft
  });
});

describe('SSO — error screen', () => {
  it('renders the error screen for creation-disabled accessibly', () => {
    cy.visit('/id/sso/google/error?reason=creation-disabled', {
      failOnStatusCode: false,
    });
    cy.contains(/No account was found/i).should('exist');
    checkA11y(); // /sso/:provider/error
  });
});

describe('SSO — link sign-in-required', () => {
  it('renders sign-in-required prompt on /sso/link (no session)', () => {
    cy.visit('/id/sso/link?provider=google', { failOnStatusCode: false });
    cy.contains(/signed in/i).should('exist');
    checkA11y(); // /sso/link (no-session prompt)
  });
});
