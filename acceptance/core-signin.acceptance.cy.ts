// Core sign-in acceptance: proves the ZitadelAuthProvider adapter against a REAL
// Zitadel Session API (catches proto drift the fake provider cannot).
//
// Gated: runs only with `--env ACCEPTANCE=1` (the fast fake-provider suite skips it).
// The app server must already be running with AUTH_PROVIDER=zitadel pointed at a
// real instance, e.g. the local stack:
//
//   SESSION_SECRET=<32+ chars> NODE_ENV=production AUTH_PROVIDER=zitadel \
//   ZITADEL_API_URL=https://auth.localtest.me:30000 \
//   ZITADEL_SERVICE_USER_TOKEN=<pat> NODE_EXTRA_CA_CERTS=./dev-ca.crt \
//   bunx start-server-and-test 'bun run start' http-get://localhost:3000/healthz \
//     'bunx cypress run --spec acceptance/core-signin.acceptance.cy.ts --env ACCEPTANCE=1'
//
// Credentials default to the LOCAL dev-stack test user (see the INDEX execution
// log, 2026-06-13); override via CYPRESS_ACCEPTANCE_LOGIN_NAME / _PASSWORD.
//
// STATE NOTE: the journey is state-tolerant. A password-only user lands on the
// skippable /setup/mfa prompt the FIRST time (30-day skip policy) and directly on
// /signed-in while a prior skip is fresh — both are correct; the spec handles both.

const RUN = String(Cypress.env('ACCEPTANCE') ?? '') === '1';

const LOGIN_NAME = String(Cypress.env('ACCEPTANCE_LOGIN_NAME') ?? 'zitadel-e2e-user2');
const PASSWORD = String(Cypress.env('ACCEPTANCE_PASSWORD') ?? 'LocalDev-Passw0rd!');
// A standalone (no-authRequest) login now routes to the DEFAULT APP: /id/signed-in
// 302-redirects a non-admin to Zitadel's login-settings defaultRedirectUri (locally the
// cloud-portal) and an admin to /ui/console. That target is CROSS-ORIGIN from this spec's
// baseUrl, so the journey no longer terminates on the /id/signed-in page.
const DEFAULT_APP = String(Cypress.env('ACCEPTANCE_DEFAULT_APP') ?? 'localhost:3001');

(RUN ? describe : describe.skip)('core sign-in (real Zitadel)', () => {
  it('identifier → password → (skippable MFA prompt) → routed to the default app', () => {
    // Observe the REAL /id/signed-in redirect and neutralize the cross-origin hop: rewrite it
    // to a same-origin 200 so Cypress doesn't navigate to (and choke on) the external app,
    // while still asserting the server issued a 302 → the default app. This proves the full
    // ceremony (password verified by Zitadel, session established) AND the default-destination
    // routing, without depending on the external app being up.
    cy.intercept('GET', '**/id/signed-in*', (req) => {
      req.continue((res) => {
        res.headers['x-observed-status'] = String(res.statusCode);
        res.headers['x-observed-location'] = String(res.headers['location'] ?? '');
        res.statusCode = 200;
        res.body = 'redirect-observed';
      });
    }).as('postLogin');

    // Screens are SSR + native form POST — no hydration opt-in needed.
    cy.visit('/id/login');
    cy.get('input[name="loginName"]').type(LOGIN_NAME);
    cy.get('button[type="submit"]').first().click();

    cy.location('pathname').should('eq', '/id/login/password');
    cy.get('input[name="password"]').type(PASSWORD, { log: false });
    cy.get('button[type="submit"]').first().click();

    // Real password verified by Zitadel. Tolerate the skippable MFA-enrollment prompt (shown
    // the first time per the 30-day skip policy); a fresh skip goes straight through.
    cy.location('pathname').then((path) => {
      if (path === '/id/setup/mfa') {
        cy.contains('button', /skip for now/i).click();
      }
    });

    // The ceremony reached /id/signed-in and the server redirected to the default app.
    cy.wait('@postLogin').then(({ response }) => {
      expect(response?.headers?.['x-observed-status'], 'standalone login should 302').to.eq('302');
      expect(String(response?.headers?.['x-observed-location'])).to.contain(DEFAULT_APP);
    });
  });
});

// Module scope: prevents top-level const collisions across acceptance specs under tsc.
export {};
