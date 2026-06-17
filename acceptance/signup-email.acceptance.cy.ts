// Email signup → verification acceptance (real Zitadel + Mailpit).
// Proves the full registration entry/exit: /id/signup (collect email/names) →
// /id/signup/password (set password → register() creates a REAL Zitadel user and
// Zitadel sends a verification email to Mailpit) → the emailed link lands on OUR
// /id/verify with the code pre-filled (the verifyUrlTemplate fix; without it the
// link would point at Zitadel's built-in page) → POST /id/verify → /verify/success.
//
// Gated: runs only with `--env ACCEPTANCE=1`. App must run with AUTH_PROVIDER=zitadel
// AND PUBLIC_ORIGIN=http://localhost:3000 (the verification link is now built from
// the trusted PUBLIC_ORIGIN, not the request Host header; in production+zitadel boot
// fails closed without it) against the local stack; the cypress process needs
// NODE_EXTRA_CA_CERTS=./dev-ca.crt (cy.request reaches Zitadel over the self-signed
// dev CA) AND Mailpit must be port-forwarded (svc/mailpit 8025) so the fetchEmailCode
// task can read the mail. See the INDEX log (2026-06-13).
//
// NOTE: signup mutates real state — each run creates a brand-new Zitadel user, so
// the email MUST be unique per run.

const RUN = String(Cypress.env('ACCEPTANCE') ?? '') === '1';

// Unique recipient per run — signup creates a real user keyed on this email.
const EMAIL = `e2e-signup-${Date.now()}@example.test`;
const PASSWORD = String(Cypress.env('ACCEPTANCE_PASSWORD') ?? 'LocalDev-Passw0rd!');

// Bounded poll for the verification mail. Zitadel sends within ~1s in practice
// (observed live), but we retry to absorb SMTP jitter. 12 × 1s = 12s ceiling —
// deterministic, no arbitrary fixed sleep.
const MAX_POLLS = 12;
const POLL_MS = 1000;

type EmailHit = { id: string; code: string; userId: string; link: string } | null;

function pollForCode(attempt: number): Cypress.Chainable<{ code: string; userId: string }> {
  return cy.task<EmailHit>('fetchEmailCode', { to: EMAIL }).then((hit) => {
    if (hit && hit.code && hit.userId) {
      return cy.wrap({ code: hit.code, userId: hit.userId });
    }
    if (attempt >= MAX_POLLS) {
      throw new Error(`No verification email for ${EMAIL} after ${MAX_POLLS} polls`);
    }
    return cy.wait(POLL_MS).then(() => pollForCode(attempt + 1));
  });
}

(RUN ? describe : describe.skip)('signup → email verification (real Zitadel + Mailpit)', () => {
  it('registers a real user, receives the Mailpit code, and verifies the email', () => {
    // 1. Collect email + names on /signup.
    cy.visit('/id/signup');
    cy.get('input[name="email"]').type(EMAIL);
    cy.get('input[name="firstName"]').type('E2E');
    cy.get('input[name="lastName"]').type('Signup');
    cy.get('button[type="submit"]').first().click();

    // 2. Org allows password → /signup/password. Setting a password registers the
    //    user in Zitadel, which sends the verification email to Mailpit.
    cy.location('pathname').should('include', '/id/signup/password');
    cy.get('input[name="password"]').type(PASSWORD, { log: false });
    cy.get('input[name="confirm"]').type(PASSWORD, { log: false });
    cy.get('button[type="submit"]').first().click();

    // Enumeration-safe terminal: the action renders a generic "check your email"
    // card (it never redirects to a live /verify, which would leak existence).
    cy.contains(/check your email/i);

    // 3. Pull the real code + userId from the Mailpit message (bounded poll).
    pollForCode(1).then(({ code, userId }) => {
      expect(code, 'verification code extracted from Mailpit').to.match(/^[A-Z0-9]{4,8}$/);
      expect(userId, 'userId extracted from the emailed /verify link').to.match(/^\d+$/);

      // 4. Follow the emailed link onto OUR /verify with the code pre-filled.
      cy.visit(`/id/verify?code=${code}&userId=${userId}&loginName=${encodeURIComponent(EMAIL)}`);
      cy.get('input[name="code"]:visible').should('have.value', code);

      // 5. Submit → real verifyEmail → /verify/success.
      cy.get('input[name="code"]:visible').closest('form').submit();
      cy.location('pathname', { timeout: 10000 }).should(
        'match',
        /\/(verify\/success|signed-in|authorize)/
      );
    });
  });
});

// Module scope: prevents top-level const collisions across acceptance specs under tsc.
export {};
