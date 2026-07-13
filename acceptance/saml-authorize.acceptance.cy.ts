// SAML SP-initiated SSO acceptance (real Zitadel as SAML IdP).
// Proves the full SP-initiated flow: a minted (unsigned, HTTP-Redirect-binding)
// AuthnRequest → Zitadel /saml/v2/SSO → our /id/login?samlRequest= bridge →
// /authorize SAML branch → identifier → password → (skippable MFA) → real
// createSamlResponse (POST binding) → the saml-post BFF auto-submit page →
// a cross-origin POST to the SP's ACS carrying a genuine base64 SAMLResponse.
//
// Gated: runs only with `--env ACCEPTANCE=1`. App must run with AUTH_PROVIDER=zitadel
// against the local stack; the cypress process needs NODE_EXTRA_CA_CERTS=./dev-ca.crt so
// cy.request can reach Zitadel over the self-signed dev CA. See the INDEX log (2026-06-13).
//
// CRITICAL TRAP: the saml-post page AUTO-SUBMITS to https://sp.localtest.me/acs and there is
// NO real SP listening there. We cy.intercept the cross-origin ACS POST and stub a 200 — this
// is the most robust option because it PROVES the auto-submit script actually fired the form
// with a non-empty SAMLResponse (a passive fetch of the page would only prove it rendered).
// The intercepted request body is inspected: SAMLResponse must base64-decode to SAML XML with
// a Success StatusCode, confirming the assertion came from the real adapter (createSamlResponse),
// not a synthetic fixture.

const RUN = String(Cypress.env('ACCEPTANCE') ?? '') === '1';

const ZITADEL = String(Cypress.env('ZITADEL_API_URL') ?? 'https://auth.localtest.me:30000');
const SSO = `${ZITADEL}/saml/v2/SSO`;
const ACS = 'https://sp.localtest.me/acs';
// user2 is the CLEAN password-only ceremony user (user3 has live TOTP enrolled).
const LOGIN_NAME = String(Cypress.env('ACCEPTANCE_LOGIN_NAME') ?? 'zitadel-e2e-user2');
const PASSWORD = String(Cypress.env('ACCEPTANCE_PASSWORD') ?? 'LocalDev-Passw0rd!');

const SAML_SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';

(RUN ? describe : describe.skip)('SAML SP-initiated SSO (real Zitadel)', () => {
  it('AuthnRequest → login ceremony → POST binding → ACS receives a Success SAMLResponse', () => {
    // 1. Mint a minimal unsigned AuthnRequest (HTTP-Redirect binding wire format) and deliver
    //    it to Zitadel's SSO endpoint without following the redirect.
    cy.task<string>('mintSamlRedirect', { sso: SSO }).then((samlRequestParam) => {
      const ssoUrl = `${SSO}?SAMLRequest=${samlRequestParam}&RelayState=${encodeURIComponent('acc-test')}`;

      cy.request({ url: ssoUrl, followRedirect: false }).then((resp) => {
        expect(resp.status, 'Zitadel SSO redirects into our login UI').to.be.oneOf([302, 303]);
        const loc = String(resp.headers['location'] ?? '');
        expect(loc, 'redirect carries samlRequest').to.contain('samlRequest=');
        const samlRequest = loc.replace(/.*samlRequest=([^&]*).*/, '$1');

        // Stub the cross-origin ACS POST BEFORE the ceremony so the auto-submit is captured.
        // (No real SP listens at sp.localtest.me/acs.) The stub records the POSTed form body.
        cy.intercept('POST', `${ACS}*`, {
          statusCode: 200,
          body: '<!doctype html><title>ACS OK</title>SP received assertion',
        }).as('acsPost');

        // 2. Enter our UI exactly where Zitadel sends the browser.
        cy.visit(`/id/login?samlRequest=${samlRequest}`);

        // bridge → /authorize → no session → /login?requestId=saml_<id>
        cy.location('pathname').should('eq', '/id/login');
        // CODE-MIN-37: the SAML flow is stateless — the request carries the SAML context, not a
        // server-side store. Guard against a regression to the old cookie-based path.
        cy.location('search').should('include', 'requestId=saml_');

        cy.get('input[name="loginName"]').type(LOGIN_NAME);
        cy.get('button[type="submit"]').first().click();

        cy.location('pathname').should('eq', '/id/login/password');
        cy.get('input[name="password"]').type(PASSWORD, { log: false });
        cy.get('button[type="submit"]').first().click();

        // Skippable MFA prompt may appear for a password-only user.
        cy.location('pathname', { timeout: 10000 }).then((path) => {
          if (path === '/id/setup/mfa') {
            cy.contains('button', /skip for now/i).click();
          }
        });

        // 3. The ceremony resolves the SAML request (real createSamlResponse, POST binding),
        //    lands on the saml-post BFF page, and its nonce'd script auto-submits to the ACS.
        cy.wait('@acsPost', { timeout: 15000 }).then((interception) => {
          // The intercepted request body is the urlencoded SAML form.
          const rawBody = String(interception.request.body ?? '');
          const params = new URLSearchParams(rawBody);
          const samlResponse = params.get('SAMLResponse') ?? '';
          expect(
            samlResponse,
            'ACS POST carries a non-empty SAMLResponse'
          ).to.have.length.greaterThan(0);
          // Decode and assert it is a genuine SAML success assertion from the real adapter.
          const xml = atob(samlResponse);
          expect(xml, 'SAMLResponse decodes to a SAML Response element').to.contain('Response');
          expect(xml, 'assertion carries a Success StatusCode').to.contain(SAML_SUCCESS);
        });
      });
    });
  });
});

// Module scope: prevents top-level const collisions across acceptance specs under tsc.
export {};
