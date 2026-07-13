import { checkA11y } from '../support/a11y';

// axe / WCAG 2.2 AA per-screen gate

// Callback route query params: ?id=<intentId>&token=<intentToken>
// The fake provider accepts any token for seeded intents.

describe('SSO — IdP buttons on /login', () => {
  it('renders an IdP button per active provider (Google, GitHub)', () => {
    // The rebuilt IdP-first /login renders each active provider as an icon + the bare provider
    // NAME (<Trans>{idp.name}</Trans> in routes/login/index.tsx), NOT the old "Continue with X"
    // phrasing. The seed (select.server.ts) activates idps named "Google" and "GitHub", so the
    // submit buttons read exactly "Google" and "GitHub". Scope to button[type=submit] so the
    // provider name in the button is matched, never an incidental occurrence elsewhere.
    cy.visit('/id/login');
    cy.get('button[type="submit"]').contains('Google').should('exist');
    cy.get('button[type="submit"]').contains('GitHub').should('exist');
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

describe('SSO — auto-create-and-link (new IdP user)', () => {
  it('callback for a truly new IdP user auto-provisions, links, and signs in', () => {
    // intent-register has userId=null and no same-email Datum account → decideIdpCallback returns
    // kind:'auto-create' (idp-callback.ts:104-105 "Truly new user → auto-create, link, and sign in
    // directly in the callback"; pinned by the idp-callback unit test "auto-creates when no existing
    // account matches"). The rebuild REPLACED the OLD "register" decision (which redirected to a
    // prefilled /signup form for manual completion) with direct auto-provisioning that creates the
    // account, links the IdP identity, and establishes the session — so the callback lands the user
    // on the signed-in terminal screen, never /signup. (Server emits signup.requested → 302 /signed-in.)
    cy.visit('/id/sso/google/callback?id=intent-register&token=t', {
      failOnStatusCode: false,
    });
    cy.location('pathname').should('match', /\/(id\/)?signed-in$/);
    checkA11y(); // /signed-in terminal screen (auto-provisioned account)
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
