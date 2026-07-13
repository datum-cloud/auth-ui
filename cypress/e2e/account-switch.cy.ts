import { checkA11y } from '../support/a11y';
import { loginAndGetSession } from '../support/session';

/**
 * P5 Task 14 — two sessions → /accounts → switch
 *
 * switch-a@acme.test and switch-b@acme.test have authMethods=['password'] only
 * (seeded in select.server.ts). Both complete login without any 2nd factor so they
 * land fully authenticated (nextStep → /signed-in).
 *
 * Dedicated seed users are used so the account-switch spec does not share session
 * state with any enrollment spec (the fake is a singleton across the full suite run).
 *
 * Interaction style: the shared support/session loginAndGetSession plants each session
 * via React-Router's single-fetch `.data` endpoint (a native bare POST /id/login 405s
 * against the SSR build — see support/session.ts), then cy.visit for the /accounts
 * screen, then native form.submit() for the switch. Both sessions accumulate in the
 * shared Cypress cookie jar so the /accounts visit carries both in the `sessions` cookie.
 */

describe('account switcher — two sessions', () => {
  it('shows two account cards, switches to the second, lands on /signed-in', () => {
    // Plant two fully-authenticated sessions in the cookie jar.
    loginAndGetSession('switch-a@acme.test');
    loginAndGetSession('switch-b@acme.test');

    // Visit /accounts — both sessions should now appear.
    cy.visit('/id/accounts');

    // Accessibility check on the account picker screen.
    checkA11y();

    // Assert two account cards are rendered.
    cy.get('[class*="rounded-lg border"]').should('have.length.gte', 2);

    // The M9 row renders the account's DISPLAY NAME (account.displayName ?? loginName); the seed
    // gives switch-b@acme.test displayName "Switch User B" (select.server.ts), so that — not the
    // email — is the visible text. Find switch-b's row by its display name and click its switch
    // control. Per the M9 fix the row's whole info area IS a <button type=submit intent=switch>
    // (the remove form is a separate sibling button), and the switch form precedes the remove
    // form in DOM order, so .first() targets the switch submit.
    cy.contains('Switch User B')
      .closest('[class*="rounded-lg border"]')
      .within(() => {
        cy.get('button[type="submit"]').first().click();
      });

    // Switching a fully-active (password-only, no-MFA) session lands on /signed-in — the M10 fix:
    // switch suppresses the skippable MFA-setup nudge and resolves the continuation destination,
    // so it must NOT bounce to /setup/mfa.
    cy.location('pathname').should('eq', '/id/signed-in');
  });
});
