// Email-link (passwordless) signup acceptance — real Zitadel + Mailpit.
// Proves the new passwordless entry/exit: /id/signup (collect email; name parsed
// from it) → /id/signup/method → "Email me a sign-in link" → register() creates a
// REAL Zitadel user and Zitadel sends the verification email to Mailpit → the emailed
// link lands on OUR /id/signup/complete (built from signupCompleteUrlTemplate) which
// verifies the email, enrolls otpEmail, self-authenticates the session, and redirects
// to the skippable passkey nudge at /id/setup/passkey.
//
// Gated: runs only with `--env ACCEPTANCE=1`. App must run with AUTH_PROVIDER=zitadel
// AND PUBLIC_ORIGIN=http://localhost:3000 against the local stack; the cypress process
// needs NODE_EXTRA_CA_CERTS=./dev-ca.crt AND Mailpit port-forwarded (svc/mailpit 8025)
// so the fetchEmailCode task can read the mail. Mirrors signup-email.acceptance.cy.ts.
//
// NOTE: signup mutates real state — each run creates a brand-new Zitadel user, so the
// email MUST be unique per run.

const RUN = String(Cypress.env('ACCEPTANCE') ?? '') === '1';

// Unique recipient per run — signup creates a real user keyed on this email.
const LINK_EMAIL = `e2e-emaillink-${Date.now()}@example.test`;

// Bounded poll for the sign-in/verification mail (absorbs SMTP jitter; no fixed sleep).
const MAX_POLLS = 12;
const POLL_MS = 1000;

type LinkEmailHit = { id: string; code: string; userId: string; link: string } | null;

function pollForLink(attempt: number): Cypress.Chainable<{ code: string; userId: string }> {
  return cy.task<LinkEmailHit>('fetchEmailCode', { to: LINK_EMAIL }).then((hit) => {
    if (hit && hit.code && hit.userId) {
      return cy.wrap({ code: hit.code, userId: hit.userId });
    }
    if (attempt >= MAX_POLLS) {
      throw new Error(`No signup-complete email for ${LINK_EMAIL} after ${MAX_POLLS} polls`);
    }
    return cy.wait(POLL_MS).then(() => pollForLink(attempt + 1));
  });
}

(RUN ? describe : describe.skip)('email-link signup (real Zitadel + Mailpit)', () => {
  it('registers via email link, follows the Mailpit link, and lands authenticated', () => {
    // 1. Collect email on /signup (name parsed from it; field behind the "Email" reveal).
    cy.visit('/id/signup');
    cy.contains('button', /^Email$/).click();
    cy.get('input[name="email"]:visible').type(LINK_EMAIL);
    cy.contains('button', /^Continue$/i).click();

    // 2. Method screen → choose the email sign-in link. This registers the user and
    //    sends the verification email (link → /id/signup/complete) to Mailpit.
    cy.location('pathname').should('include', '/id/signup/method');
    cy.contains('button', /email me a sign-in link/i).click();

    // Enumeration-safe terminal: generic "check your email" card (no live redirect).
    cy.contains(/check your email/i);

    // 3. Pull the real code + userId from the Mailpit message (bounded poll).
    pollForLink(1).then(({ code, userId }) => {
      expect(code, 'code extracted from Mailpit').to.match(/^[A-Z0-9]{4,8}$/);
      expect(userId, 'userId extracted from the emailed link').to.match(/^\d+$/);

      // 4. Follow the emailed link onto OUR /signup/complete. The loader verifies the
      //    email, enrolls otpEmail, self-authenticates, and redirects to the skippable
      //    passkey nudge. (next=passkey is carried by signupCompleteUrlTemplate.)
      cy.visit(
        `/id/signup/complete?code=${code}&userId=${userId}&next=passkey&loginName=${encodeURIComponent(LINK_EMAIL)}`
      );

      // 5. Authenticated session → skippable passkey setup (or straight signed-in).
      cy.location('pathname', { timeout: 10000 }).should(
        'match',
        /\/(setup\/passkey|signed-in|authorize)/
      );
    });
  });
});

// Module scope: prevents top-level const collisions across acceptance specs under tsc.
export {};
