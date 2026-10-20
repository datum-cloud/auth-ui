// cypress/e2e/passkey-conditional.cy.ts
//
// The usernameless fast path end-to-end against the fake provider:
// hint written on an ordinary login → session expires → /login signs the user in with
// zero typing → logout clears the hint → the fast path goes inert. Runs real WebAuthn
// ceremonies on Chrome's virtual authenticator: the planted u5 resident credential resolves the
// conditional get() with no tap. passkey-user@acme.test (u5) is the one seeded user with BOTH a
// password (writes the hint via ordinary login) and a passkey (verify path).
import { PASSKEY_U5 } from '../fixtures/passkey-u5';
import { extractCsrf, loginAndGetSession } from '../support/session';
import {
  addVirtualAuthenticator,
  expectPostedRealCredential,
  plantCredential,
  removeVirtualAuthenticator,
  visitRealWebAuthn,
} from '../support/virtual-authenticator';

const USER = 'passkey-user@acme.test';

// USER has TWO primary methods (password + passkey), so the identifier step routes to the
// /login/method chooser. What this spec needs is a COMPLETED password login (that action is
// what writes the passkey hint), so drive the factor explicitly via cy.request — deterministic,
// and independent of which factor the shared session helper happens to satisfy while planting
// the cookie. The password UI journey itself is core-signin.cy.ts's subject.
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

describe('usernameless passkey fast path', () => {
  // Warm Vite's dep optimization once (mirrors core-signin.cy.ts / passkeys-manage.cy.ts): the
  // first cold route load triggers a hard reload that drops any onBeforeLoad-injected window
  // flag — fatal here, since every test below relies on __webAuthnRealCeremony /
  // __CYPRESS_HYDRATE__ surviving the visit uninterrupted. Wait for the SSR'd "Email" button so
  // the cold reload has fully settled before any real test-critical visit occurs.
  before(() => {
    cy.visit('/id/login');
    cy.contains('button', /email/i);
  });

  let authenticatorId: string;

  beforeEach(() => {
    cy.intercept('POST', /\/id\/login\/passkey(\.data)?(\?|$)/).as('verify');
    addVirtualAuthenticator().then((id) => {
      authenticatorId = id;
    });
  });

  afterEach(() => {
    if (authenticatorId) removeVirtualAuthenticator(authenticatorId);
    authenticatorId = '';
  });

  const plantU5 = () => plantCredential(authenticatorId, PASSKEY_U5);

  it('hint written on login → fast path signs in with zero typing → logout clears it', () => {
    plantU5();
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
    visitRealWebAuthn('/id/login');
    cy.location('pathname').should('eq', '/id/signed-in');
    cy.contains(USER);
    expectPostedRealCredential('@verify', authenticatorId);

    // 4. Sign out → the hint pointed at the signing-out user, so it is cleared.
    // SignOutButton's form action is `${APP_BASENAME}/logout?index` (the ?index routes a
    // native <form> post to the logout INDEX route's action, not its action-less layout).
    cy.get('form[action="/id/logout?index"]').submit();
    cy.location('pathname').should('eq', '/id/logout/success');
    cy.getCookie('passkey-hint').should('not.exist');

    // 5. No hint → the page stays QUIET even with a resolvable credential (ambient arming is
    // hinted-only — no fresh-load auto-prompt). Discovery is
    // BUTTON-initiated: the Passkey button signs in via userHandle resolution, and
    // the verify success re-writes the hint (browser self-upgrade).
    visitRealWebAuthn('/id/login');
    cy.location('pathname').should('eq', '/id/login');
    cy.contains('button', /passkey/i).click();
    cy.location('pathname').should('eq', '/id/signed-in');
    cy.getCookie('passkey-hint').should('exist');
    expectPostedRealCredential('@verify', authenticatorId);
  });

  it('add-another-account arrival keeps the hint dark but discovery still arms', () => {
    plantU5();
    signInWithPassword(USER);
    cy.clearCookie('sessions');
    visitRealWebAuthn('/id/login?add=1');
    // ?add=1 suppresses only the HINT arm — no zero-typing auto sign-in.
    cy.location('pathname').should('eq', '/id/login');
    // Discovery arms regardless of ?add=1 (the cascade) — the Passkey button still
    // resolves the tapped credential's identity and signs in.
    cy.contains('button', /passkey/i).click();
    cy.location('pathname').should('eq', '/id/signed-in');
    cy.contains(USER);
    expectPostedRealCredential('@verify', authenticatorId);
  });

  it("add-another-account with a LIVE session: tapping the signed-in account's own passkey routes to the accounts picker", () => {
    // Distinct from the test above: THAT test clears the `sessions` cookie before
    // visiting ?add=1, so it never reaches a live session and never reaches the 409 branch
    // this covers. "Add another account" implies a session already exists — THIS test keeps
    // it live. The planted PASSKEY_U5 credential's userHandle (base64url('u5')) resolves to USER, so tapping
    // it while USER's own session is live is the reported bug's exact repro: the discover
    // action's ALREADY_SIGNED_IN 409 branch must fire, and the client must land on the
    // accounts picker (not /signed-in, which would resolve mostRecent() rather than the
    // tapped account, and not the opaque-failure copy — the session already exists).
    plantU5();
    signInWithPassword(USER);
    visitRealWebAuthn('/id/login?add=1');
    cy.location('pathname').should('eq', '/id/login');
    cy.contains('button', /passkey/i).click();
    cy.location('pathname').should('eq', '/id/accounts');
    // The picker renders the seeded fake-provider displayName ("Passkey User"), not the
    // raw loginName — same convention as accounts.tsx (`account.displayName ??
    // account.loginName`). "Session active" confirms it landed on USER's own live row,
    // not an empty picker or a different account.
    cy.contains('Passkey User');
    cy.contains('Session active');
  });

  it('an armed (un-resolved) ceremony never blocks the ordinary identifier flow', () => {
    // Hint present but NO credential on the authenticator: the conditional ceremony parks;
    // typing + submitting must win (the page aborts the armed ceremony on submit).
    signInWithPassword(USER);
    cy.clearCookie('sessions');
    visitRealWebAuthn('/id/login');
    cy.contains('button', /email/i).click();
    cy.get('input[name="loginName"]').should('have.attr', 'autocomplete', 'username webauthn');
    cy.get('input[name="loginName"]').type('alice@acme.test');
    cy.get('input[name="loginName"]:visible').closest('form').submit();
    // The identifier step's destination for any account with >= 1 usable method is the
    // /login/method chooser. What this test pins is that the ordinary submit WON — the URL
    // advanced off /id/login instead of the parked ceremony swallowing it.
    cy.location('pathname').should('eq', '/id/login/method');
  });
});
