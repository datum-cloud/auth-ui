import { checkA11y } from '../support/a11y';

describe('core sign-in (fake provider)', () => {
  // Warm Vite's dep optimization once. The first cold route load triggers a hard reload
  // (Vite re-optimizing deps) that drops the onBeforeLoad __CYPRESS_HYDRATE__ flag, so
  // hydration is skipped and settleHydration() times out. Warming up first keeps every real
  // visit hydrated. We wait for the SSR'd "Email" button so the cold reload has fully settled.
  before(() => {
    cy.visit('/id/login');
    cy.contains('button', 'Email');
  });

  it('identifier → password → signed-in', () => {
    cy.visit('/id/login', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true; // hydrate so the IdP-first "Email" reveal + form work (see entry.client.tsx)
      },
    });
    cy.settleHydration();
    checkA11y(); // /login renders

    // The email input is behind an "Email" reveal button (IdP-first UX); click it first.
    cy.contains('button', 'Email').click();
    cy.get('input[name="loginName"]').type('alice@acme.test');
    cy.get('input[name="loginName"]:visible').closest('form').submit();

    cy.location('pathname').should('eq', '/id/login/password');
    checkA11y(); // /login/password renders
    cy.get('input[name="password"]').type('hunter2');
    cy.get('input[name="password"]:visible').closest('form').submit();

    cy.location('pathname').should('eq', '/id/signed-in');
    cy.contains('You are signed in');
    cy.contains('alice@acme.test');
    checkA11y(); // /signed-in renders
  });

  it('wrong password shows an error and stays on the password screen', () => {
    cy.visit('/id/login', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true; // hydrate so the IdP-first "Email" reveal + form work (see entry.client.tsx)
      },
    });
    cy.settleHydration();
    cy.contains('button', 'Email').click();
    cy.get('input[name="loginName"]').type('alice@acme.test');
    cy.get('input[name="loginName"]:visible').closest('form').submit();
    cy.get('input[name="password"]').type('wrong-password');
    cy.get('input[name="password"]:visible').closest('form').submit();
    cy.location('pathname').should('eq', '/id/login/password');
    checkA11y(); // /login/password (error state) renders
  });

  it('the error screen passes a11y', () => {
    // The error page is tamper-proof: it maps a known ?code= to a FIXED message and never
    // reflects raw ?title=/?error= query values (security remediation). code=request_expired
    // → the fixed title "Login request expired".
    cy.visit('/id/error?code=request_expired');
    cy.contains('Login request expired');
    checkA11y(); // /error renders
  });

  it('the logout-success screen passes a11y', () => {
    cy.visit('/id/logout/success');
    checkA11y(); // /logout/success renders
  });
});
