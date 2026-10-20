import { checkA11y } from '../support/a11y';
import { loginAndGetSession } from '../support/session';

// Not in scripts/e2e-fast.sh: u2f-user has no virtual-authenticator credential yet.
describe('Security key verify (/login/security-key)', () => {
  it('renders accessibly, drives ceremony via Cypress path, redirects to /signed-in', () => {
    // Plant the session cookie for u2f-user@acme.test
    loginAndGetSession('u2f-user@acme.test');

    cy.visit('/id/login/security-key?loginName=u2f-user%40acme.test', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true; // ceremony needs JS — opt into hydration (see entry.client.tsx)
      },
    });
    cy.settleHydration();

    checkA11y();

    // Hydration gate: the button is disabled until React mounts; Cypress waits for it.
    cy.contains('button', /verify with security key/i)
      .should('not.be.disabled')
      .click();

    // The prebaked credential verifies with userVerified=true → nextStep returns /signed-in.
    cy.location('pathname').should('eq', '/id/signed-in');
  });
});
