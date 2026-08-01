import { checkA11y } from '../support/a11y';
import { chooseMethodPassword } from '../support/session';

/**
 * P5 Task 14 — forced MFA setup journey
 *
 * forced-user@acme.test has authMethods=['password'] only (no 2nd factor enrolled).
 * The organization 'force-org' has forceMfa=true in settingsByOrg (seeded in select.server.ts).
 *
 * After the password action, nextStep sees:
 *   - forceMfa=true (from org settings)
 *   - no enrolled 2nd factors
 *   → routes to /setup/mfa?force=true&checkAfter=true&loginName=...&organization=...
 *
 * The user clicks "Authenticator app" → /setup/authenticator (checkAfter=true threaded)
 * → enters any 6-digit code → enrolled → because checkAfter=true → /login/verify/authenticator
 * → enters code again → second factor verified → nextStep returns /signed-in.
 *
 * Interaction style: native form.submit() / link clicks — same pattern as core-signin.cy.ts.
 */
describe('forced MFA setup → enroll authenticator → signed-in', () => {
  it('routes unenrolled user through forced setup then to signed-in', () => {
    // Login with organization=force-org (forceMfa=true).
    cy.visit('/id/login?organization=force-org');
    cy.get('input[name="loginName"]').type('forced-user@acme.test');
    cy.get('input[name="loginName"]:visible').closest('form').submit();

    chooseMethodPassword();

    cy.location('pathname').should('eq', '/id/login/password');
    cy.get('input[name="password"]').type('hunter2');
    cy.get('input[name="password"]:visible').closest('form').submit();

    // nextStep: forceMfa=true, no 2nd factor enrolled → /setup/mfa with force=true.
    cy.location('pathname').should('eq', '/id/setup/mfa');
    cy.location('search').should('include', 'force=true');

    // Accessibility check on the forced setup screen.
    checkA11y();

    // Click the "Authenticator app" link (from CAPABILITY_ROUTES in setup.mfa.tsx).
    cy.contains('a', /authenticator app/i).click();

    cy.location('pathname').should('eq', '/id/setup/authenticator');

    // Enter any 6-digit code (fake accepts any code).
    cy.get('input[name="code"]').type('123456');
    cy.get('input[name="code"]:visible').closest('form').submit();

    // checkAfter=true → after enrollment, redirect to verify screen.
    cy.location('pathname').should('eq', '/id/login/verify/authenticator');

    // Verify the newly enrolled TOTP factor.
    cy.get('input[name="code"]').type('123456');
    cy.get('input[name="code"]:visible').closest('form').submit();

    // Second factor verified → nextStep returns /signed-in.
    cy.location('pathname').should('eq', '/id/signed-in');
  });
});
