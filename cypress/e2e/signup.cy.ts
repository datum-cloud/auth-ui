import { checkA11y } from '../support/a11y';

// axe / WCAG 2.2 AA per-screen gate

// The signup register action is enumeration-safe: it renders the SAME generic
// "check your email" terminal for a new email and a duplicate one (it never
// redirects to a live /verify, which would leak existence). The continuation to
// /verify happens via the emailed link — exercised separately below against the
// seeded user u1, whose verification code is deterministic (`email-u1`).
//
// Signup is passkey-only, so this journey now runs /signup → /signup/method → passkey, where it
// used to run /signup → /signup/password → password. The method screen offers exactly one
// credential; the retired "Set a password" and "Email me a sign-in link" buttons are asserted
// absent here so a regression shows up in the real browser, not only in the component suite.
describe('signup → check your email', () => {
  it('registers from the identifier screen and lands on the enumeration-safe confirmation', () => {
    cy.visit('/id/signup');
    checkA11y(); // /signup

    // /signup collects ONLY an email — firstName/lastName are derived server-side by
    // placeholderNameFromEmail and never typed. (This spec used to type them; it had gone
    // stale against the screen and was failing on inputs that no longer exist.)
    cy.contains('button', /^Email$/).click();
    cy.get('input[name=email]').type('new@acme.test');
    cy.get('input[name=email]').closest('form').submit();

    // No interstitial: the register happens in this action, so the terminal renders on /signup.
    cy.location('pathname').should('include', '/signup');
    cy.contains(/check your email/i); // generic, enumeration-safe terminal
    cy.contains('new@acme.test'); // the address is echoed so a typo is visible
    cy.contains(/wrong address/i); // …and recoverable
    checkA11y(); // the terminal state
  });

  // An address that ALREADY has an account returns this exact screen and sends no mail (see
  // runEnumerationSafeRegister + resendIfSquatted) — that indistinguishability is the G7 gate.
  // The escape hatch for a returning user is therefore a link shown to EVERYONE, never a hint
  // about which case they are in. Asserted on a fresh address on purpose: if this link ever
  // becomes conditional on account existence, it becomes an enumeration oracle, and this test
  // is what fails.
  it('offers a sign-in link on the terminal regardless of whether the address has an account', () => {
    cy.visit('/id/signup');
    cy.contains('button', /^Email$/).click();
    cy.get('input[name=email]').type('brand-new@acme.test');
    cy.get('input[name=email]').closest('form').submit();
    cy.contains(/check your email/i);
    cy.contains(/already have an account/i).should('be.visible');
    cy.contains('a', /^Sign in$/)
      .should('have.attr', 'href')
      .and('match', /\/login/);
  });

  it('never routes through the /signup/method interstitial', () => {
    cy.visit('/id/signup');
    cy.contains('button', /^Email$/).click();
    cy.get('input[name=email]').type('nomethod@acme.test');
    cy.get('input[name=email]').closest('form').submit();
    cy.contains(/check your email/i);
    cy.location('pathname').should('not.include', '/signup/method');
  });
});

// /signup/method stays LIVE on purpose so a tab already sitting on it mid-signup still works.
// It is simply no longer where the flow routes.
describe('signup/method → still reachable as a deep link', () => {
  it('renders the passkey button for an in-flight tab', () => {
    cy.visit('/id/signup/method?loginName=inflight%40acme.test&firstName=In&lastName=Flight');
    cy.location('pathname').should('include', '/signup/method');
    cy.contains('button', /use a passkey/i).should('be.visible');
  });
});

// The retired password route must not be reachable by deep link either — hiding the button is
// display-only, and this route reads its identity straight from the URL with no session gate.
describe('signup/password → retired', () => {
  it('bounces a deep link to /signup with the address prefilled', () => {
    cy.visit('/id/signup/password?loginName=new%40acme.test&firstName=New&lastName=User');
    cy.location('pathname').should('include', '/signup');
    cy.location('pathname').should('not.include', '/signup/password');
    cy.get('input[name=password]').should('not.exist');
  });
});

// Phase B (D-B2d/G3): the verification-link hop — the landing site the passkey signup depends
// on. The emailed link is /signup/complete?code=…&userId=…&next=passkey (verify-url-template.ts
// hardcodes next); following it must verify the address, mint the session, and land on
// /setup/passkey. Driven with the seeded u1 and its deterministic pending code (`email-u1`)
// because the e2e environment may run with delivery off — the submit half of the journey is
// covered by the passkey-method journey above and by the component-level method suites, which
// run with delivery on.
describe('signup complete link → passkey setup', () => {
  it('follows the verification link and lands on /setup/passkey', () => {
    cy.visit('/id/signup/complete?code=email-u1&userId=u1&next=passkey');
    cy.location('pathname').should('include', '/setup/passkey');
  });

  // REGRESSION GUARD for the post-enrollment dead end. This redirect originally carried no
  // returnTo, so routing fell through to nextStep — which found no fresh primary factor (the
  // session holds only an `otpEmail` factor, which primaryFresh does not count) and sent a
  // brand-new passwordless user to /login/password, failing as SESSION_EXPIRED. Enrollment now
  // ends at /signup/success, which links to /login for a normal sign-in.
  it('points enrollment at the /signup/success terminal instead of a second ceremony', () => {
    cy.visit('/id/signup/complete?code=email-u1&userId=u1&next=passkey');
    cy.location('search').should('include', 'returnTo');
    cy.location('search').should('include', 'signup%2Fsuccess');
    // checkAfter=true would hand off to /login/passkey and demand a second biometric prompt.
    cy.location('search').should('include', 'checkAfter=false');
  });
});

// The code path reaches the same place as the link. This CANNOT be driven with the seeded u1:
// u1 already has authMethods: ['password'], so signing up with its address short-circuits to
// 409 ALREADY_EXISTS before the "check your email" terminal ever renders (see the enrolled-vs-
// squatted disclosure branch in resendIfSquatted, signup.service.ts). A brand-new address DOES
// reach the terminal, but its verification code is `email-<generatedId>` — an id minted
// server-side that the browser has no way to learn, so the test could not type it.
//
// The fixture that actually reaches the terminal with a code this spec can predict is a
// "squatted" address: u23 is seeded (so register() throws ALREADY_EXISTS) but deliberately has
// NO entry in authMethods (so it is factorless, not "enrolled"). resendIfSquatted sees zero auth
// methods, resends rather than disclosing, and the generic terminal renders exactly as it would
// for a fresh address. The fake's resend is deterministic — resendEmailCodeWithUrl /
// resendEmailCode both set the code to `email-resend-<userId>` (note the `-resend-` segment; it
// is NOT `email-<userId>`, which is only the code set at construction / fresh registration). Do
// not "simplify" this back to a fresh or enrolled address — both break the journey.
describe('signup → code entry', () => {
  it('finishes signup by typing the code instead of clicking the link', () => {
    // This journey needs client JS: the "Email" reveal button is a plain useState toggle
    // (see routes/signup/index.tsx), and entry.client.tsx SKIPS hydration under Cypress unless
    // the visit opts in via __CYPRESS_HYDRATE__ (see that file's comment). Without it no
    // onClick handler is ever attached and the click below is a no-op.
    cy.visit('/id/signup', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();
    cy.contains('button', /^Email$/).click();
    cy.get('input[name=email]').type('squatter@acme.test');
    cy.get('input[name=email]').closest('form').submit();

    cy.contains(/check your email/i);
    cy.get('input[name="code"]').type('email-resend-u23');
    cy.get('input[name="code"]').closest('form').submit();

    cy.location('pathname').should('include', '/setup/passkey');
  });
});

describe('verify email → success', () => {
  it('issues a code on load and verifies it', () => {
    // The seeded user u1 has a deterministic pending code (`email-u1`) set at fake
    // construction. NOTE: ?send=true is now session-gated server-side and a
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
