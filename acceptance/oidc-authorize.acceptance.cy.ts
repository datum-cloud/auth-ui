// OIDC authorize → callback acceptance (real Zitadel).
// Proves the full code-flow entry: Zitadel /oauth/v2/authorize → our /login?authRequest
// bridge → /authorize orchestrator (real getAuthRequest('oidc')) → identifier → password
// → (skippable MFA) → createCallback → redirect to the client redirect_uri with ?code=.
//
// Gated: runs only with `--env ACCEPTANCE=1`. App must run with AUTH_PROVIDER=zitadel
// AND PUBLIC_ORIGIN=http://localhost:3000 (required-in-prod since the verification-link
// origin is sourced from trusted config, not the request Host header — boot fails closed
// without it) against the local stack; the cypress process needs NODE_EXTRA_CA_CERTS=./dev-ca.crt
// so cy.request can reach Zitadel over the self-signed dev CA. See the INDEX log (2026-06-13).

const RUN = String(Cypress.env('ACCEPTANCE') ?? '') === '1';

const ZITADEL = String(Cypress.env('ZITADEL_API_URL') ?? 'https://auth.localtest.me:30000');
const CLIENT_ID = String(Cypress.env('OIDC_CLIENT_ID') ?? '377158963730317363');
const REDIRECT_URI = String(
  Cypress.env('OIDC_REDIRECT_URI') ?? 'http://localhost:3000/auth/callback'
);
const LOGIN_NAME = String(Cypress.env('ACCEPTANCE_LOGIN_NAME') ?? 'zitadel-e2e-user3');
const PASSWORD = String(Cypress.env('ACCEPTANCE_PASSWORD') ?? 'LocalDev-Passw0rd!');

// Fixed PKCE challenge — we only assert a code is issued, never exchange it.
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

(RUN ? describe : describe.skip)('OIDC authorize → callback (real Zitadel)', () => {
  it('completes the code flow and redirects to the client with ?code=', () => {
    // 1. Mint a real authRequest at Zitadel's authorize endpoint (no redirect-follow).
    const authorizeUrl =
      `${ZITADEL}/oauth/v2/authorize?client_id=${CLIENT_ID}` +
      `&response_type=code&scope=${encodeURIComponent('openid profile')}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256&state=acc-test`;

    cy.request({ url: authorizeUrl, followRedirect: false }).then((resp) => {
      expect(resp.status).to.be.oneOf([302, 303]);
      const loc = String(resp.headers['location'] ?? '');
      expect(loc, 'Zitadel authorize redirects into our login UI').to.contain('authRequest=');
      const authRequest = loc.replace(/.*authRequest=([^&]*).*/, '$1');

      // 2. Enter our UI exactly where Zitadel sends the browser.
      cy.visit(`/id/login?authRequest=${authRequest}`);

      // bridge → /authorize → no session → /login?requestId=oidc_<id>
      cy.location('pathname').should('eq', '/id/login');
      cy.location('search').should('include', 'requestId=oidc_');

      cy.get('input[name="loginName"]').type(LOGIN_NAME);
      cy.get('button[type="submit"]').first().click();

      cy.location('pathname').should('eq', '/id/login/password');
      cy.get('input[name="password"]').type(PASSWORD, { log: false });
      cy.get('button[type="submit"]').first().click();

      // Skippable MFA prompt may appear for a password-only user.
      cy.location('pathname').then((path) => {
        if (path === '/id/setup/mfa') {
          cy.contains('button', /skip for now/i).click();
        }
      });

      // 3. The ceremony resolves the OIDC request → 302 to the client redirect_uri with a code.
      cy.location('href', { timeout: 10000 }).should('include', 'code=');
      cy.location('pathname').should('eq', '/auth/callback');
    });
  });
});

// Module scope: prevents top-level const collisions across acceptance specs under tsc.
export {};
