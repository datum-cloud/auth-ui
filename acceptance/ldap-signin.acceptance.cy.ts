// LDAP credential sign-in acceptance (real Zitadel with a glauth LDAP IdP).
// Drives the direct-signin surface: /id/sso/ldap?idpId=<ldap-idp> → username/password
// form → real adapter startLdapIntent (live LDAP credential exchange against glauth) →
// the Phase-4 intent→session path (signInWithIdpIntent).
//
// FIXTURE STATE — IMPORTANT: the seeded glauth user `ldap-e2e-user` authenticates
// successfully but is NOT linked to any Zitadel account. Real Zitadel therefore returns
// an idpIntent with userId='' (a 'register' draft, not a sign-in). Direct sign-in only
// supports already-linked accounts; register-and-link via LDAP is deferred (see the /sso
// `ldap-link-unsupported` guard + INDEX log). Provisioning a linked fixture would mutate
// the shared IAM service, so this spec asserts the genuine live outcome for the available
// fixture: a graceful ACCOUNT_NOT_LINKED error (HTTP 403), NOT a 500. This still proves the
// session is exercised via the REAL adapter — a wrong password yields a different
// (INVALID_CREDENTIALS) outcome, and an unhandled error would surface as a 500 error page.
//
// To assert the signed-in green path instead, set Cypress.env('LDAP_EXPECT_SIGNED_IN','1')
// AND point LDAP_USERNAME/LDAP_PASSWORD at a glauth user that IS linked to a Zitadel
// account; the spec then asserts the /id/signed-in landing.
//
// Gated: runs only with `--env ACCEPTANCE=1`. App must run with AUTH_PROVIDER=zitadel
// against the local stack; the cypress process needs NODE_EXTRA_CA_CERTS=./dev-ca.crt so
// requests can reach Zitadel over the self-signed dev CA. See the INDEX log (2026-06-13).

const RUN = String(Cypress.env('ACCEPTANCE') ?? '') === '1';

const IDP_ID = String(Cypress.env('LDAP_IDP_ID') ?? '377159167858704435');
const USERNAME = String(Cypress.env('LDAP_USERNAME') ?? 'ldap-e2e-user');
const PASSWORD = String(Cypress.env('LDAP_PASSWORD') ?? 'LocalDev-Passw0rd!');
const EXPECT_SIGNED_IN = String(Cypress.env('LDAP_EXPECT_SIGNED_IN') ?? '') === '1';

(RUN ? describe : describe.skip)('LDAP credential sign-in (real Zitadel + glauth IdP)', () => {
  it('credentials → real startLdapIntent → graceful linked-account outcome (no 500)', () => {
    // 1. Enter the LDAP credential screen for the live LDAP IdP.
    cy.visit(`/id/sso/ldap?idpId=${IDP_ID}`);
    cy.location('pathname').should('eq', '/id/sso/ldap');

    // Confirm the real form fields (username / password — NOT loginName).
    cy.get('input[name="username"]').should('be.visible').type(USERNAME);
    cy.get('input[name="password"]').type(PASSWORD, { log: false });
    cy.get('button[type="submit"]').first().click();

    if (EXPECT_SIGNED_IN) {
      // Green path: a LINKED LDAP user resolves to a real userId, mints a session,
      // and lands signed-in. Requires a linked glauth↔Zitadel fixture (see header).
      cy.location('pathname', { timeout: 15000 }).should('eq', '/id/signed-in');
    } else {
      // Default fixture is unlinked: the real adapter exchange succeeds (creds valid)
      // but Zitadel returns userId='' → the route surfaces a graceful, typed error and
      // re-renders the LDAP form. We assert the form is still shown with the
      // not-linked alert — and CRUCIALLY that we did NOT 500 (the prior bug) and did
      // NOT wrongly redirect to a signed-in session.
      cy.location('pathname').should('eq', '/id/sso/ldap');
      cy.get('[role="alert"]').should('contain.text', 'No account is linked');
      cy.contains(/Unexpected Server Error/i).should('not.exist');
    }
  });

  it('wrong password → real adapter rejects with INVALID_CREDENTIALS (proves the live exchange)', () => {
    // A distinct outcome for a wrong password confirms the assertion above came from a
    // genuine live LDAP credential exchange, not a static error page.
    cy.visit(`/id/sso/ldap?idpId=${IDP_ID}`);
    cy.get('input[name="username"]').type(USERNAME);
    cy.get('input[name="password"]').type('definitely-wrong-password', { log: false });
    cy.get('button[type="submit"]').first().click();

    cy.location('pathname').should('eq', '/id/sso/ldap');
    cy.get('[role="alert"]').should('contain.text', 'Invalid username or password');
  });
});

// Module scope: prevents top-level const collisions across acceptance specs under tsc.
export {};
