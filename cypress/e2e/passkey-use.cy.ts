import { checkA11y } from '../support/a11y';
import { loginAndGetSession } from '../support/session';

describe('Passkey verify (/login/passkey)', () => {
  it('renders accessibly, drives ceremony via Cypress path, redirects to /signed-in', () => {
    // Plant the session cookie for passkey-user@acme.test
    loginAndGetSession('passkey-user@acme.test');

    // Navigate directly to the passkey verify screen with loginName threaded.
    cy.visit('/id/login/passkey?loginName=passkey-user%40acme.test', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true; // ceremony needs JS — opt into hydration (see entry.client.tsx)
      },
    });
    cy.settleHydration();

    checkA11y();

    // The WebAuthnButton detects window.Cypress and uses the pre-baked credential.
    // Hydration gate: the button is disabled until React mounts; Cypress waits for it.
    cy.contains('button', /sign in with .*passkey|touch id|windows hello/i)
      .should('not.be.disabled')
      .click();

    // The fake provider marks passkey factor verified + userVerified=true,
    // so nextStep returns /signed-in deterministically.
    cy.location('pathname').should('eq', '/id/signed-in');
  });
});

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

    // The fake provider marks passkey.userVerified=true → nextStep returns /signed-in.
    cy.location('pathname').should('eq', '/id/signed-in');
  });
});

describe('Passkey / security-key — no session guard', () => {
  it('redirects to /login when visiting passkey screen without a session', () => {
    cy.visit('/id/login/passkey?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });

  it('redirects to /login when visiting security-key screen without a session', () => {
    cy.visit('/id/login/security-key?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });
});
