import { checkA11y } from '../support/a11y';
import { loginAndGetSession } from '../support/session';

// ─── Device code entry (/device) ─────────────────────────────────────────────

describe('Device code entry (/device)', () => {
  it('renders accessibly and accepts the seeded WDJB-MJHT code', () => {
    // Sign in first — the authorize consent screen requires a valid session.
    loginAndGetSession('alice@acme.test');

    cy.visit('/id/device');

    checkA11y();

    // Type the seeded user code and submit via the Continue button.
    cy.get('input[name="userCode"]').clear().type('WDJB-MJHT');
    cy.contains('button[type="submit"]', /continue/i).click();

    // Action redirects to the authorize screen with the requestId + user_code params.
    cy.location('pathname').should('eq', '/id/device/authorize');
    cy.location('search').should('include', 'user_code=WDJB-MJHT');

    checkA11y();

    // Consent screen must show the app name and scope from the seeded device auth.
    cy.contains(/CLI/i).should('be.visible');
    cy.contains(/openid/i).should('be.visible');

    // Authorize — scope the selector to a button to avoid matching the card title.
    cy.contains('button', /^authorize$/i).click();

    // Terminal state: action returns done:'authorize', component swaps in-place.
    cy.contains(/you may return to your device/i).should('be.visible');

    checkA11y();
  });
});

// ─── Device deny (sessionless) ────────────────────────────────────────────────

describe('Device deny (sessionless)', () => {
  it('allows denial without a signed-in session and shows terminal state', () => {
    // No loginAndGetSession — denial must work without a cookie per RFC 8628.
    // The loader only reads user_code; requestId rides in the form from loader data.
    cy.visit('/id/device/authorize?user_code=DENY-CODE');

    cy.contains('button', /^deny$/i).click();

    cy.contains(/you may return to your device/i).should('be.visible');
  });
});

// ─── Device — unknown code returns error ──────────────────────────────────────

describe('Device code entry — unknown code', () => {
  it('shows a not-found error for an unrecognised code', () => {
    cy.visit('/id/device');

    cy.get('input[name="userCode"]').clear().type('XXXX-XXXX');
    cy.contains('button[type="submit"]', /continue/i).click();

    cy.contains(/code not found/i).should('be.visible');
    checkA11y(); // error render is a distinct DOM state — axe it too
  });
});
