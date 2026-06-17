import { checkA11y } from '../support/a11y';

// Seeded password for all fake-provider test users (see app/providers/select.server.ts passwords map).
const FAKE_PASSWORD = 'hunter2';

/**
 * Extract the csrf hidden-input token from SSR HTML. React entity-escapes
 * attribute values (& → &amp; etc.), so decode before round-tripping the token —
 * otherwise tokens containing escapable chars 403 intermittently.
 */
function extractCsrf(html: string): string {
  const raw = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

/**
 * Establishes a session cookie for the given loginName via cy.request (no UI).
 * Drives identifier → password steps so byLoginName finds a valid entry.
 * cy.request shares the browser cookie jar; set-cookie headers from the actions
 * apply to the subsequent cy.visit.
 */
function loginAndGetSession(loginName: string) {
  cy.request('/id/login').then((resp) => {
    const csrf = extractCsrf(resp.body as string);
    cy.request({
      method: 'POST',
      url: '/id/login',
      form: true,
      body: { csrf, loginName },
      followRedirect: false,
    }).then((post) => {
      const target = String(post.headers.location ?? '');
      if (target.includes('/login/password')) {
        const pwPageUrl = target.startsWith('http')
          ? target
          : `/id${target.startsWith('/id') ? target.slice(3) : target}`;
        cy.request(pwPageUrl).then((pwPage) => {
          const pwCsrf = extractCsrf(pwPage.body as string) || csrf;
          cy.request({
            method: 'POST',
            url: target,
            form: true,
            body: { csrf: pwCsrf, loginName, password: FAKE_PASSWORD },
            followRedirect: false,
          });
        });
      }
    });
  });
}

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
