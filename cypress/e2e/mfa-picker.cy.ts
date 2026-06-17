import { checkA11y } from '../support/a11y';
import { loginAndGetSession } from '../support/session';

// ─── Case 1: Two enrolled 2nd factors → picker renders one button per method ───

describe('MFA method picker (/login/mfa) — multi-method user', () => {
  it('renders accessibly with one button per enrolled 2nd-factor method', () => {
    // mfa2-user@acme.test has authMethods=['password','totp','otp_email'] → two 2nd factors.
    loginAndGetSession('mfa2-user@acme.test');

    cy.visit('/id/login/mfa?loginName=mfa2-user%40acme.test');

    checkA11y();

    // Picker must render exactly two submit buttons — one per enrolled 2nd factor.
    cy.get('button[type="submit"]').should('have.length', 2);
  });

  it('clicking the TOTP option redirects to /login/verify/authenticator', () => {
    loginAndGetSession('mfa2-user@acme.test');

    cy.visit('/id/login/mfa?loginName=mfa2-user%40acme.test');

    // Submit the totp form — native POST, no hydration required.
    cy.contains('button[type="submit"]', /authenticator/i).click();

    cy.location('pathname').should('eq', '/id/login/verify/authenticator');
  });
});

// ─── Case 2: Single enrolled 2nd factor → loader short-circuits to use screen ───

describe('MFA method picker (/login/mfa) — single-method short-circuit', () => {
  it('loader redirects directly to /login/verify/authenticator (no picker rendered)', () => {
    // totp-user@acme.test has authMethods=['password','totp'] → exactly one 2nd factor.
    loginAndGetSession('totp-user@acme.test');

    // Visiting /login/mfa with a single-method user should skip the picker entirely.
    cy.visit('/id/login/mfa?loginName=totp-user%40acme.test', { failOnStatusCode: false });

    cy.location('pathname').should('eq', '/id/login/verify/authenticator');
  });
});

// ─── Guard: no session ───

describe('MFA method picker — no session guard', () => {
  it('redirects to /login when visiting picker without a session', () => {
    cy.visit('/id/login/mfa?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });
});
