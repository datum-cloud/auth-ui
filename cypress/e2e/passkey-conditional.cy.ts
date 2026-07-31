// cypress/e2e/passkey-conditional.cy.ts
//
// The usernameless fast path end-to-end against the fake provider:
// hint written on an ordinary login → session expires → /login signs the user in with
// zero typing (conditional ceremony auto-resolved via the Cypress seam) → logout clears
// the hint → the fast path goes inert. u5 passkey-user@acme.test is the one seeded user
// with BOTH a password (writes the hint via ordinary login) and a passkey (verify path).
import { extractCsrf, loginAndGetSession } from '../support/session';

const USER = 'passkey-user@acme.test';

// USER has TWO primary methods (password + passkey), so the identifier step routes to
// the /login/method chooser — loginAndGetSession leaves the session at the bare identifier
// check (never signed in), same gap passkeys-manage.cy.ts's signInMiaWithPassword documents
// for mia@acme.test. Complete the password factor via cy.request (deterministic; the
// password UI journey is core-signin.cy.ts's subject) so the action's passkey-hint write fires.
function signInWithPassword(loginName: string) {
  loginAndGetSession(loginName);
  cy.request(`/id/login/password?loginName=${encodeURIComponent(loginName)}`).then((resp) => {
    const csrf = extractCsrf(resp.body as string);
    cy.request({
      method: 'POST',
      url: `/id/login/password.data?loginName=${encodeURIComponent(loginName)}`,
      form: true,
      body: { csrf, loginName, password: 'hunter2' },
      followRedirect: false,
    });
  });
}

const visitLoginArmed = (path = '/id/login') =>
  cy.visit(path, {
    onBeforeLoad: (win) => {
      win.__CYPRESS_HYDRATE__ = true; // the ceremony needs JS (see entry.client.tsx)
      (
        win as unknown as { __conditionalPasskeyAutoResolve?: boolean }
      ).__conditionalPasskeyAutoResolve = true; // simulate "user taps the passkey in the autofill dropdown"
    },
  });

describe('usernameless passkey fast path', () => {
  // Warm Vite's dep optimization once (mirrors core-signin.cy.ts / passkeys-manage.cy.ts): the
  // first cold route load triggers a hard reload that drops any onBeforeLoad-injected window
  // flag — fatal here, since every test below relies on __conditionalPasskeyAutoResolve /
  // __CYPRESS_HYDRATE__ surviving the visit uninterrupted. Wait for the SSR'd "Email" button so
  // the cold reload has fully settled before any real test-critical visit occurs.
  before(() => {
    cy.visit('/id/login');
    cy.contains('button', /email/i);
  });

  it('hint written on login → fast path signs in with zero typing → logout clears it', () => {
    // 1. Ordinary password login writes the hint (alongside last-used-login).
    signInWithPassword(USER);
    cy.getCookie('passkey-hint').should('exist');

    // 2. Session gone, hint intact — exactly the returning-user population the path serves.
    cy.clearCookie('sessions');

    // 3. Zero-typing sign-in: loader arms, ceremony auto-resolves, verify redirects.
    // settleHydration's sacrificial click forces React past the Cypress-only head-injection
    // hydration mismatch (see support/e2e.ts) — without it the auto-fire effect that arms the
    // conditional ceremony never runs, since React defers regenerating the mismatched tree
    // until the first dispatched event.
    visitLoginArmed();
    cy.settleHydration();
    cy.location('pathname').should('eq', '/id/signed-in');
    cy.contains(USER);

    // 4. Sign out → the hint pointed at the signing-out user, so it is cleared.
    // SignOutButton's form action is `${APP_BASENAME}/logout?index` (the ?index routes a
    // native <form> post to the logout INDEX route's action, not its action-less layout).
    cy.get('form[action="/id/logout?index"]').submit();
    cy.location('pathname').should('eq', '/id/logout/success');
    cy.getCookie('passkey-hint').should('not.exist');

    // 5. No hint → the page stays QUIET even with auto-resolve armed (ambient arming is
    // hinted-only — no fresh-load auto-prompt). Discovery is
    // BUTTON-initiated: the Passkey button signs in via userHandle resolution, and
    // the verify success re-writes the hint (browser self-upgrade).
    visitLoginArmed();
    cy.settleHydration();
    cy.location('pathname').should('eq', '/id/login');
    cy.contains('button', /passkey/i).click();
    cy.location('pathname').should('eq', '/id/signed-in');
    cy.getCookie('passkey-hint').should('exist');
  });

  it('add-another-account arrival suppresses the fast path', () => {
    signInWithPassword(USER);
    cy.clearCookie('sessions');
    visitLoginArmed('/id/login?add=1');
    cy.settleHydration();
    cy.location('pathname').should('eq', '/id/login');
  });

  it('an armed (un-resolved) ceremony never blocks the ordinary identifier flow', () => {
    // Hint present but NO auto-resolve: the ceremony parks; typing + submitting must win
    // (the page aborts the armed ceremony on submit).
    signInWithPassword(USER);
    cy.clearCookie('sessions');
    cy.visit('/id/login', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();
    cy.contains('button', /email/i).click();
    cy.get('input[name="loginName"]').should('have.attr', 'autocomplete', 'username webauthn');
    cy.get('input[name="loginName"]').type('alice@acme.test');
    cy.get('input[name="loginName"]:visible').closest('form').submit();
    cy.location('pathname').should('eq', '/id/login/password');
  });
});
