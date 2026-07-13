import { checkA11y } from '../support/a11y';

/**
 * Establishes a session cookie for the given loginName by driving the full
 * identifier → password flow. After this helper the browser holds a valid
 * `sessions` cookie that the verify-screen loader will find via byLoginName.
 *
 * The fake's getLoginSettings returns forceMfa=false, so login.password.tsx
 * (which uses composed nextStep routing) routes to /signed-in — that's fine.
 * We then navigate directly to the verify screen; the session cookie is set.
 */
function loginAndGetSession(loginName: string) {
  cy.visit('/id/login');
  cy.get('input[name="loginName"]').type(loginName);
  cy.get('input[name="loginName"]:visible').closest('form').submit();
  cy.location('pathname').should('eq', '/id/login/password');
  cy.get('input[name="password"]').type('hunter2');
  cy.get('input[name="password"]:visible').closest('form').submit();
  // Wait for the redirect to complete (signed-in or any auth page)
  cy.location('pathname').should('match', /\/(id\/)?(signed-in|login)/);
}

describe('MFA verify — TOTP (/login/verify/authenticator)', () => {
  it('renders accessibly, accepts a code, and redirects deterministically', () => {
    // Drive the login flow to plant the session cookie for totp-user@acme.test
    loginAndGetSession('totp-user@acme.test');

    // Navigate directly to the TOTP verify screen with loginName threaded.
    // cy.clock() is intentionally NOT used here: cypress-axe uses Promises that
    // cy.clock() stubs out (the fake timer never advances), causing checkA11y to hang.
    // Determinism is guaranteed by the fake provider: passwordCheckLifetimeMs=0 and
    // secondFactorCheckLifetimeMs=0 mean no lifetime expiry regardless of wall clock.
    cy.visit('/id/login/verify/authenticator?loginName=totp-user%40acme.test');

    checkA11y();

    cy.get('input[name="code"]').type('123456');
    cy.contains('button', /verify/i).click();

    // secondFactorCheckLifetimeMs=0 → never expires; one totp factor enrolled →
    // nextStep returns /signed-in deterministically.
    cy.location('pathname').should('eq', '/id/signed-in');
  });
});

describe('MFA verify — Email OTP (/login/verify/email)', () => {
  it('renders accessibly, accepts a code, and redirects deterministically', () => {
    loginAndGetSession('email-otp-user@acme.test');

    cy.visit('/id/login/verify/email?loginName=email-otp-user%40acme.test');

    checkA11y();

    cy.get('input[name="code"]').type('123456');
    cy.contains('button', /verify/i).click();

    cy.location('pathname').should('eq', '/id/signed-in');
  });
});

describe('MFA verify — SMS OTP (/login/verify/sms)', () => {
  it('renders accessibly, accepts a code, and redirects deterministically', () => {
    loginAndGetSession('sms-otp-user@acme.test');

    cy.visit('/id/login/verify/sms?loginName=sms-otp-user%40acme.test');

    checkA11y();

    cy.get('input[name="code"]').type('123456');
    cy.contains('button', /verify/i).click();

    cy.location('pathname').should('eq', '/id/signed-in');
  });
});

describe('MFA verify — no session guard', () => {
  it('redirects to /login when visiting verify screen without a session', () => {
    // No login flow — no session cookie for this loginName
    cy.visit('/id/login/verify/authenticator?loginName=nobody%40acme.test', {
      failOnStatusCode: false,
    });
    cy.location('pathname').should('eq', '/id/login');
  });
});
