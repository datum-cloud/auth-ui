/**
 * Consolidated WCAG 2.2 AA axe sweep — Phase 7 Task 3
 *
 * Visits every indexed ceremony screen against the fake provider and asserts
 * ZERO axe violations via the shared checkA11y() helper (cypress/support/a11y.ts).
 *
 * Existing helper ruleset: { 'color-contrast': { enabled: true } } — axe default
 * tags (wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice). The helper does NOT
 * currently pass the wcag22aa tag explicitly; axe-core's default run already
 * covers the WCAG 2.2 AA rules that axe supports as of the version bundled in
 * cypress-axe. We do NOT override the helper in this file — all per-screen specs
 * inherit the same configuration.
 *
 * Screen reachability notes (per loader audit):
 *
 *   /login              — no guard, plain visit
 *   /login/password     — no session guard; ?loginName seeds the field so the
 *                         real form renders (otherwise an empty field still
 *                         renders the same markup — included for completeness)
 *   /login/method       — SESSION guard (the loader is state-changing) → requires
 *                         loginAndGetSession first; use mia@acme.test, whose two
 *                         methods (password + passkey) render the real chooser
 *                         with no sole-method auto-start short-circuit
 *   /signup             — no guard, plain visit
 *   /signup/password    — no session guard; ?loginName seeds it (same as above)
 *   /password/reset     — no guard, plain visit
 *   /password/new       — no session guard; ?code + ?userId are read from
 *                         searchParams only (loader never redirects without them)
 *   /verify             — no session guard; ?userId + ?send=true seeds a code
 *                         (mirrors signup.cy.ts)
 *   /sso/link           — no session → loader returns mode:'sign-in-required'
 *                         (sign-in prompt UI, not a redirect) — plain visit
 *   /login/passkey      — session guard → requires loginAndGetSession first;
 *                         mirrors passkey-use.cy.ts (passkey-user@acme.test)
 *   /login/mfa          — session guard → requires loginAndGetSession first;
 *                         use mfa2-user@acme.test (2 factors → picker renders,
 *                         no short-circuit redirect) — mirrors mfa-picker.cy.ts
 *   /login/verify/email — session guard → requires loginAndGetSession first;
 *                         mirrors verify-otp.cy.ts (email-otp-user@acme.test)
 *   /device             — no session guard; bare entry screen renders without a
 *                         session (mirrors device.cy.ts)
 *   /sso                — session guard → requires loginAndGetSession first;
 *                         alice@acme.test has no IdP links so the management
 *                         screen renders the sign-out button (stable anchor).
 *                         Uses alice@acme.test — no-link state avoids side
 *                         effects on other specs' seeded IdP state.
 */
import { checkA11y } from '../support/a11y';
import { loginAndGetSession } from '../support/session';

// ─── Screens reachable without a session ─────────────────────────────────────

describe('a11y sweep — /login', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    cy.visit('/id/login');
    cy.location('pathname').should('include', '/login');
    checkA11y();
  });
});

describe('a11y sweep — /login/password', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    cy.visit('/id/login/password?loginName=alice%40acme.test');
    cy.location('pathname').should('include', '/login/password');
    checkA11y();
  });
});

describe('a11y sweep — /signup', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    cy.visit('/id/signup');
    cy.location('pathname').should('include', '/signup');
    checkA11y();
  });
});

describe('a11y sweep — /signup/password', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    cy.visit('/id/signup/password?loginName=new%40acme.test&firstName=New&lastName=User');
    cy.location('pathname').should('include', '/signup/password');
    checkA11y();
  });
});

describe('a11y sweep — /password/reset', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    cy.visit('/id/password/reset');
    cy.location('pathname').should('include', '/password/reset');
    checkA11y();
  });
});

describe('a11y sweep — /password/new', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    // Fake deterministic reset code for seeded user u1 (mirrors password-reset.cy.ts)
    cy.visit('/id/password/new?code=reset-u1&userId=u1');
    cy.location('pathname').should('include', '/password/new');
    checkA11y();
  });
});

describe('a11y sweep — /verify', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    // ?send=true triggers the email code send on load (mirrors signup.cy.ts)
    cy.visit('/id/verify?userId=u1&send=true&loginName=alice%40acme.test');
    cy.location('pathname').should('include', '/verify');
    checkA11y();
  });
});

describe('a11y sweep — /sso/link (no-session sign-in-required state)', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    // Without a session the loader returns mode:'sign-in-required' — a real UI
    // render (not a redirect). Mirrors sso.cy.ts "SSO — link sign-in-required".
    cy.visit('/id/sso/link?provider=google', { failOnStatusCode: false });
    cy.contains(/signed in/i).should('exist');
    cy.location('pathname').should('include', '/sso/link');
    checkA11y();
  });
});

describe('a11y sweep — /device', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    cy.visit('/id/device');
    cy.location('pathname').should('include', '/device');
    checkA11y();
  });
});

// ─── Screens that require a valid session ─────────────────────────────────────

describe('a11y sweep — /login/passkey (session required)', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    // passkey-user@acme.test has a passkey enrolled; identifier POST creates the
    // session and the loader finds it via byLoginName. Mirrors passkey-use.cy.ts.
    loginAndGetSession('passkey-user@acme.test');

    cy.visit('/id/login/passkey?loginName=passkey-user%40acme.test');
    cy.location('pathname').should('include', '/login/passkey');
    // Positive assertion: WebAuthnButton renders its "Verify with passkey" text
    // (disabled until React hydrates, but SSR-rendered DOM is present).
    cy.contains('button', /sign in with .*passkey|touch id|windows hello/i).should('exist');
    checkA11y();
  });
});

describe('a11y sweep — /login/method (session required, multi-method user)', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    // mia@acme.test has password + passkey, so the chooser RENDERS: a sole-method account
    // would be short-circuited (a lone linked IdP redirects from the loader; a lone passkey
    // auto-begins its ceremony on mount) and there would be no screen to sweep.
    loginAndGetSession('mia@acme.test');

    cy.visit('/id/login/method?loginName=mia%40acme.test');
    cy.location('pathname').should('eq', '/id/login/method');
    // Positive assertion: both method entries render as real links (the no-JS contract).
    cy.contains('a', 'Passkey').should('exist');
    cy.contains('a', 'Password').should('exist');
    checkA11y();
  });
});

describe('a11y sweep — /login/mfa (session required, multi-method user)', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    // mfa2-user@acme.test has totp + otp_email (2 factors) → picker renders,
    // no short-circuit redirect. Mirrors mfa-picker.cy.ts.
    loginAndGetSession('mfa2-user@acme.test');

    cy.visit('/id/login/mfa?loginName=mfa2-user%40acme.test');
    cy.location('pathname').should('include', '/login/mfa');
    cy.get('button[type="submit"]').should('have.length', 2);
    checkA11y();
  });
});

describe('a11y sweep — /login/verify/email (session required)', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    // email-otp-user@acme.test has otp_email enrolled. Loader sends the OTP on
    // load, then renders the code-entry form. Mirrors verify-otp.cy.ts.
    loginAndGetSession('email-otp-user@acme.test');

    cy.visit('/id/login/verify/email?loginName=email-otp-user%40acme.test');
    cy.location('pathname').should('include', '/login/verify/email');
    // Positive assertion: OTP code input rendered (Form.Field name="code").
    cy.get('input[name="code"]').should('exist');
    checkA11y();
  });
});

describe('a11y sweep — /sso (session required, SSO management screen)', () => {
  it('passes axe (WCAG 2.2 AA)', () => {
    // alice@acme.test is a plain password user with no IdP links — the management
    // screen renders the sign-out button (stable anchor). Using alice avoids
    // disturbing other specs' seeded IdP state.
    loginAndGetSession('alice@acme.test');

    cy.visit('/id/sso');
    cy.location('pathname').should('include', '/sso');
    // Positive assertion: AuthCard title "Linked accounts" confirms management screen rendered.
    cy.contains('h1,h2,h3', /linked accounts/i).should('exist');
    checkA11y();
  });
});
