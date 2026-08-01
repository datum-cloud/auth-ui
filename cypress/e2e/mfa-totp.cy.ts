import { chooseMethodPassword } from '../support/session';

/**
 * P5 Task 14 — password → TOTP → signed-in
 *
 * totp-user@acme.test has authMethods=['password','totp'] (seeded in select.server.ts).
 * After the password action the composed nextStep engine sees one enrolled 2nd factor (totp)
 * and routes to /login/verify/authenticator. Entering any code there satisfies the second
 * factor and nextStep returns /signed-in.
 *
 * Interaction style: native form.submit() — same pattern as core-signin.cy.ts.
 * The app runs in NO-HYDRATION mode when window.Cypress is defined (entry.client.tsx gate),
 * so React never takes over; every form submission is a full-page HTML POST.
 */
describe('password → TOTP → signed-in', () => {
  it('completes second-factor login', () => {
    cy.visit('/id/login');
    cy.get('input[name="loginName"]').type('totp-user@acme.test');
    cy.get('input[name="loginName"]:visible').closest('form').submit();

    chooseMethodPassword();

    cy.location('pathname').should('eq', '/id/login/password');
    cy.get('input[name="password"]').type('hunter2');
    cy.get('input[name="password"]:visible').closest('form').submit();

    // After password the composed nextStep sees totp enrolled → routes to verify/authenticator.
    cy.location('pathname').should('eq', '/id/login/verify/authenticator');

    cy.get('input[name="code"]').type('123456');
    cy.get('input[name="code"]:visible').closest('form').submit();

    // secondFactorCheckLifetimeMs=0 → never expires; nextStep returns /signed-in.
    cy.location('pathname').should('eq', '/id/signed-in');
  });
});
