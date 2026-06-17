import { checkA11y } from '../support/a11y';

// axe / WCAG 2.2 AA per-screen gate (INDEX §C, CCD-5)

// The signup-password action is enumeration-safe: it renders the SAME generic
// "check your email" terminal for a new email and a duplicate one (it never
// redirects to a live /verify, which would leak existence). The continuation to
// /verify happens via the emailed link — exercised separately below against the
// seeded user u1, whose verification code is deterministic (`email-u1`).
describe('signup → check your email', () => {
  it('registers and lands on the enumeration-safe confirmation', () => {
    cy.visit('/id/signup');
    checkA11y(); // /signup
    cy.get('input[name=firstName]').type('New');
    cy.get('input[name=lastName]').type('User');
    cy.get('input[name=email]').type('new@acme.test');
    cy.get('form').submit(); // → /signup/password (org allows password)

    cy.location('pathname').should('include', '/signup/password');
    checkA11y(); // /signup/password
    cy.get('input[name=password]').type('NewPw123!');
    cy.get('input[name=confirm]').type('NewPw123!');
    cy.get('form').submit();

    cy.contains(/check your email/i); // generic, enumeration-safe terminal
  });
});

describe('verify email → success', () => {
  it('issues a code on load and verifies it', () => {
    // The seeded user u1 has a deterministic pending code (`email-u1`) set at fake
    // construction. NOTE: ?send=true is now session-gated server-side (CODE-MAJ-08) and a
    // no-op for this unauthenticated visit — we rely on the seeded code, not a fresh send.
    cy.visit('/id/verify?userId=u1&send=true&loginName=alice@acme.test');
    checkA11y(); // /verify
    // The retrofitted /verify renders two forms: the code-entry Form.Root and a
    // separate resend form (which carries a hidden name="code" sentinel). Scope to
    // the visible entry input + its form so the selectors stay unambiguous.
    cy.get('input[name=code]:visible').type('email-u1');
    cy.get('input[name=code]:visible').closest('form').submit();
    // No active ceremony session for u1 in the cookie → terminal confirmation.
    cy.location('pathname').should('match', /\/(verify\/success|signed-in|authorize)/);
  });
});
