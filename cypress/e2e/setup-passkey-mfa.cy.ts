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

// ─── Passkey enrollment (/setup/passkey) ─────────────────────────────────────

describe('Passkey enrollment (/setup/passkey)', () => {
  it('renders accessibly, drives attestation ceremony via Cypress path, redirects to /login/passkey', () => {
    // nofactor-user@acme.test has authMethods=['password'] only — suitable for enrollment.
    loginAndGetSession('nofactor-user@acme.test');

    // Ceremony screens need JS — opt into hydration (see entry.client.tsx).
    cy.visit('/id/setup/passkey?loginName=nofactor-user%40acme.test&checkAfter=true', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();

    checkA11y();

    // The WebAuthnButton (attestation mode) detects window.Cypress and uses the pre-baked credential.
    // Hydration gate: button is disabled until React mounts; Cypress actionability waits for it.
    cy.contains('button', /register passkey|enroll passkey|set up passkey/i)
      .should('not.be.disabled')
      .click();

    // checkAfter=true → redirect into the matching passkey verify screen after enrollment.
    cy.location('pathname').should('eq', '/id/login/passkey');
  });
});

// ─── Security-key enrollment (/setup/security-key) ───────────────────────────

describe('Security-key enrollment (/setup/security-key)', () => {
  it('renders accessibly, drives attestation ceremony via Cypress path, redirects to /login/security-key', () => {
    loginAndGetSession('nofactor-user@acme.test');

    cy.visit('/id/setup/security-key?loginName=nofactor-user%40acme.test&checkAfter=true', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();

    checkA11y();

    cy.contains('button', /register security key|enroll security key|set up security key/i)
      .should('not.be.disabled')
      .click();

    cy.location('pathname').should('eq', '/id/login/security-key');
  });
});

// ─── MFA setup picker (/setup/mfa) ───────────────────────────────────────────

describe('MFA setup picker (/setup/mfa)', () => {
  it('renders accessibly, shows method links and Skip button when force=false, Skip resolves to /signed-in', () => {
    // mfa-skip-user@acme.test is a dedicated skip-only user seeded with authMethods=['password']
    // and never touched by other enrollment tests (which share the fake singleton). This avoids
    // the test-ordering hazard where nofactor-user accumulates enrolled factors (e.g. passkey)
    // across the suite, causing decideAfterIdentifier to route to /login/passkey instead of
    // /login/password, breaking the loginAndGetSession helper's password step.
    loginAndGetSession('mfa-skip-user@acme.test');

    // No hydration opt-in needed: links + native form POST don't require JS.
    cy.visit('/id/setup/mfa?loginName=mfa-skip-user%40acme.test&force=false');

    checkA11y();

    // At least one method link must be rendered (fake capabilities enable passkey + totp + email).
    cy.get('a[href*="/setup/"]').should('have.length.greaterThan', 0);

    // Skip button is present when force=false.
    cy.contains('button[type="submit"]', /skip/i).should('be.visible');

    // Click Skip → setMfaInitSkipped stamps FIXED_NOW; nextStep with fresh skip → /signed-in.
    cy.contains('button[type="submit"]', /skip/i).click();

    cy.location('pathname').should('eq', '/id/signed-in');
  });

  it('does NOT show Skip button when force=true', () => {
    loginAndGetSession('mfa-skip-user@acme.test');

    cy.visit('/id/setup/mfa?loginName=mfa-skip-user%40acme.test&force=true');

    checkA11y();

    cy.contains('button[type="submit"]', /skip/i).should('not.exist');
  });
});

// ─── Guard: no session ────────────────────────────────────────────────────────

describe('Setup passkey/security-key/mfa — no session guard', () => {
  it('redirects to /login when visiting /setup/passkey without a session', () => {
    cy.visit('/id/setup/passkey?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });

  it('redirects to /login when visiting /setup/security-key without a session', () => {
    cy.visit('/id/setup/security-key?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });

  it('redirects to /login when visiting /setup/mfa without a session', () => {
    cy.visit('/id/setup/mfa?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });
});
