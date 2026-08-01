import { checkA11y } from '../support/a11y';
import { loginAndGetSession } from '../support/session';

// Session planting is the SHARED helper's job (cypress/support/session.ts). This spec used to
// carry a private copy of it, which silently rotted the moment the identifier step stopped
// redirecting to /login/password and started routing every account through the /login/method
// chooser — two copies of one branch, only one of them updated. There is now a single copy.

// ─── TOTP enrollment (/setup/authenticator) ───────────────────────────────────

describe('TOTP enrollment (/setup/authenticator)', () => {
  it('renders accessibly, shows the secret + URI, accepts a code, and redirects to /login/verify/authenticator', () => {
    // nofactor-user@acme.test has authMethods=['password'] only (no 2nd factor).
    loginAndGetSession('nofactor-user@acme.test');

    cy.visit('/id/setup/authenticator?loginName=nofactor-user%40acme.test&checkAfter=true');

    checkA11y();

    // The TOTP secret and URI must render with data-testid attributes.
    cy.get('[data-testid="totp-secret"]').should('be.visible');
    cy.get('[data-testid="totp-uri"]').should('be.visible');

    // Enter any 6-digit code (fake accepts any code).
    cy.get('input[name="code"]').type('123456');
    cy.contains('button[type="submit"]', /verify|confirm/i).click();

    // checkAfter=true → redirect into the matching verify screen after enrollment.
    cy.location('pathname').should('eq', '/id/login/verify/authenticator');
  });
});

// ─── Email OTP enrollment (/setup/email) ─────────────────────────────────────

describe('Email OTP enrollment (/setup/email)', () => {
  it('renders accessibly, shows confirmation UI, POSTs, and redirects to /login/verify/email', () => {
    loginAndGetSession('nofactor-user@acme.test');

    cy.visit('/id/setup/email?loginName=nofactor-user%40acme.test&checkAfter=true');

    checkA11y();

    // The confirm button submits the enrollment POST.
    cy.contains('button[type="submit"]', /enable|confirm|add/i).click();

    // checkAfter=true → redirect into the matching verify screen after enrollment.
    cy.location('pathname').should('eq', '/id/login/verify/email');
  });
});

// ─── SMS OTP enrollment (/setup/sms) ─────────────────────────────────────────

describe('SMS OTP enrollment (/setup/sms)', () => {
  it('renders accessibly, shows confirmation UI, POSTs, and redirects to /login/verify/sms', () => {
    loginAndGetSession('nofactor-user@acme.test');

    cy.visit('/id/setup/sms?loginName=nofactor-user%40acme.test&checkAfter=true');

    checkA11y();

    // The confirm button submits the enrollment POST.
    cy.contains('button[type="submit"]', /enable|confirm|add/i).click();

    // checkAfter=true → redirect into the matching verify screen after enrollment.
    cy.location('pathname').should('eq', '/id/login/verify/sms');
  });
});

// ─── Guard: no session ────────────────────────────────────────────────────────

describe('Setup OTP — no session guard', () => {
  it('redirects to /login when visiting setup/authenticator without a session', () => {
    cy.visit('/id/setup/authenticator?loginName=nobody%40acme.test', {
      failOnStatusCode: false,
    });
    cy.location('pathname').should('eq', '/id/login');
  });

  it('redirects to /login when visiting setup/email without a session', () => {
    cy.visit('/id/setup/email?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });

  it('redirects to /login when visiting setup/sms without a session', () => {
    cy.visit('/id/setup/sms?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });
});
