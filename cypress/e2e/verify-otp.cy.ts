import { checkA11y } from '../support/a11y';
import { chooseMethodPassword } from '../support/session';

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
  cy.visit('/id/login', {
    onBeforeLoad: (win) => {
      win.__CYPRESS_HYDRATE__ = true; // hydrate so the IdP-first "Email" reveal works (see entry.client.tsx)
    },
  });
  cy.settleHydration();
  // The email input is behind an "Email" reveal button (IdP-first UX); click it first
  // (mirrors core-signin.cy.ts's identifier flow).
  cy.contains('button', 'Email').click();
  cy.get('input[name="loginName"]').type(loginName);
  cy.get('input[name="loginName"]:visible').closest('form').submit();
  chooseMethodPassword();
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

    // The OTP-email login completion writes the passkey-hint (mirrors last-used-login).
    cy.getCookie('passkey-hint').should('exist');
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

describe('MFA verify — Back navigation (regression: sole-factor loop)', () => {
  // Motivating bug: Back from /login/verify/{channel} used to target /login/mfa.
  // For a user with exactly one enrolled+policy-allowed second factor,
  // /login/mfa's loader short-circuits (resolveMfaPicker's sole-factor redirect
  // in mfa.service.ts) straight back to that same verify screen before any
  // picker UI renders — so clicking Back silently looped back to the page the
  // user was already on. previous-step.ts now points Back at /login directly
  // for /login/verify/* (see previousStepFor). These tests click the real
  // rendered "Back" control (not just the pure previousStepFor function) so a
  // reverted map entry would fail here even though the unit tests still pass.

  it('clicking Back on the email verify screen lands on /login, not looping back', () => {
    loginAndGetSession('email-otp-user@acme.test');
    cy.visit('/id/login/verify/email?loginName=email-otp-user%40acme.test');

    cy.contains('a, button', /^back$/i).click();

    cy.location('pathname').should('eq', '/id/login');
  });

  it('clicking Back on the SMS verify screen lands on /login, not looping back', () => {
    loginAndGetSession('sms-otp-user@acme.test');
    cy.visit('/id/login/verify/sms?loginName=sms-otp-user%40acme.test');

    cy.contains('a, button', /^back$/i).click();

    cy.location('pathname').should('eq', '/id/login');
  });

  it('clicking Back on the TOTP verify screen lands on /login, not looping back', () => {
    loginAndGetSession('totp-user@acme.test');
    cy.visit('/id/login/verify/authenticator?loginName=totp-user%40acme.test');

    cy.contains('a, button', /^back$/i).click();

    cy.location('pathname').should('eq', '/id/login');
  });
});
