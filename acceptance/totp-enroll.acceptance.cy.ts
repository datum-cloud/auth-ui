// TOTP enroll → verify acceptance (real Zitadel).
// Proves the adapter's registerTotp + verifyTotp against a live instance through the UI:
// sign in → /setup/authenticator reads a real secret → compute an RFC-6238 code (cy.task
// generateTotp) → verify-and-enable → checkAfter routes to /login/verify/authenticator →
// compute a fresh code → land signed-in.
//
// Gated: runs only with `--env ACCEPTANCE=1`.
//
// PRECONDITION — needs a TOTP-FREE user. Zitadel's registerTOTP rejects a user that
// already has TOTP, and the enrollment loader has no fallback. Set
// CYPRESS_ACCEPTANCE_TOTP_USER to a freshly-seeded user (re-run e2e-fixtures.sh, or use a
// user that has never enrolled). zitadel-e2e-user3 is NOT clean after the adapter probe
// on 2026-06-13 — the adapter path (registerTotp+verifyTotp) was validated live there.
//
// NOTE (live-validated 2026-06-13): the registerTotp→verifyTotp adapter round-trip was
// proven live with a computed code; this spec exercises the same path through the routes.

const RUN = String(Cypress.env('ACCEPTANCE') ?? '') === '1';
// CODE-MIN-36: default to the seeded TOTP-free fixtures user so the gated acceptance lane
// actually runs this spec. Override with CYPRESS_ACCEPTANCE_TOTP_USER for a different instance.
// PRECONDITION still applies: the user must NOT already have TOTP enrolled (registerTOTP rejects).
const USER = String(Cypress.env('ACCEPTANCE_TOTP_USER') ?? 'zitadel-e2e-totp');
const PASSWORD = String(Cypress.env('ACCEPTANCE_PASSWORD') ?? 'LocalDev-Passw0rd!');

(RUN && USER ? describe : describe.skip)('TOTP enroll → verify (real Zitadel)', () => {
  it('enrolls an authenticator and verifies a live code', () => {
    // 1. Establish a session (identifier → password).
    cy.visit('/id/login');
    cy.get('input[name="loginName"]').type(USER);
    cy.get('button[type="submit"]').first().click();
    cy.location('pathname').should('eq', '/id/login/password');
    cy.get('input[name="password"]').type(PASSWORD, { log: false });
    cy.get('button[type="submit"]').first().click();
    cy.location('pathname'); // session cookie is now set wherever it landed

    // 2. Enrollment screen — registerTotp shows a real secret; checkAfter routes to verify.
    cy.visit(`/id/setup/authenticator?loginName=${encodeURIComponent(USER)}&checkAfter=true`);
    cy.get('[data-testid="totp-secret"]')
      .invoke('text')
      .then((secret) => {
        cy.task('generateTotp', secret.trim()).then((code) => {
          cy.get('input[name="code"]').type(String(code));
          cy.contains('button', /verify and enable/i).click();

          // checkAfter=true → the verify screen confirms the freshly enrolled factor.
          cy.location('pathname').should('eq', '/id/login/verify/authenticator');
          cy.task('generateTotp', secret.trim()).then((code2) => {
            cy.get('input[name="code"]').type(String(code2));
            cy.get('button[type="submit"]').first().click();
            cy.location('pathname').should('eq', '/id/signed-in');
          });
        });
      });
  });
});

// Module scope: prevents top-level const collisions across acceptance specs under tsc.
export {};
