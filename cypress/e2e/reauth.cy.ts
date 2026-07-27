import { checkA11y } from '../support/a11y';
import { loginAndGetSession } from '../support/session';

// /id/reauth — sudo interstitial journey (fake provider).
// Sudo staleness is NOT required here: this spec drives /reauth directly.
describe('/id/reauth — verify one enrolled factor onto the existing session', () => {
  it('chooser lists enrolled methods only; password completion lands on returnTo', () => {
    // alice has authMethods: ['password'] only → chooser shows Password, never Passkey.
    loginAndGetSession('alice@acme.test');

    cy.visit('/id/reauth?returnTo=/passkeys', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true; // form submit needs JS (see entry.client.tsx)
      },
    });
    cy.settleHydration();
    checkA11y(); // chooser renders

    cy.contains("Confirm it's you");
    cy.contains('a', 'Password').should('be.visible');
    cy.contains('a', 'Passkey').should('not.exist');

    cy.contains('a', 'Password').click();
    cy.location('search').should('contain', 'method=password');
    checkA11y(); // password verify form renders

    cy.get('input[name="password"]').type('hunter2');
    cy.get('input[name="password"]:visible').closest('form').submit();

    // Success → redirect to the validated returnTo (served under the /id basename).
    cy.location('pathname').should('eq', '/id/passkeys');
  });

  it('lists Passkey for a passkey-enrolled user', () => {
    loginAndGetSession('passkey-user@acme.test');
    cy.visit('/id/reauth?returnTo=/passkeys');
    cy.contains('a', 'Passkey').should('be.visible');
    cy.contains('a', 'Password').should('be.visible');
  });

  it('falls back to /id/passkeys when returnTo is tampered (//evil.test)', () => {
    loginAndGetSession('alice@acme.test');

    cy.visit('/id/reauth?returnTo=%2F%2Fevil.test%2Fx&method=password', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();

    cy.get('input[name="password"]').type('hunter2');
    cy.get('input[name="password"]:visible').closest('form').submit();

    // The tampered returnTo is rejected server-side → default target, never evil.test.
    cy.location('pathname').should('eq', '/id/passkeys');
    cy.location('host').should('eq', 'localhost:3000');
  });

  it('bounces to /login without a session', () => {
    cy.clearCookies();
    cy.visit('/id/reauth', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });
});
