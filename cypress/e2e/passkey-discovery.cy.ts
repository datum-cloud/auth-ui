// cypress/e2e/passkey-discovery.cy.ts
//
// The usernameless DISCOVERY path end-to-end against the fake provider: a FRESH browser — no
// passkey-hint, no session, nothing — signs in with zero typing. The identity tap
// (auto-resolved via the Cypress seam; CYPRESS_CREDENTIAL carries userHandle
// base64url('u5')) posts to /login/passkey-discover, which resolves u5 and mints
// the real user-bound challenge; the modal ceremony auto-resolves and the verify
// action signs the user in AND writes the hint — so the next visit takes the
// one-tap HINTED path (browser self-upgrade, at-most-once-per-browser discovery).
const USER = 'passkey-user@acme.test'; // u5 — the seeded passkey user

const visitLoginArmed = () =>
  cy.visit('/id/login', {
    onBeforeLoad: (win) => {
      win.__CYPRESS_HYDRATE__ = true; // the ceremony needs JS (see entry.client.tsx)
      (
        win as unknown as { __conditionalPasskeyAutoResolve?: boolean }
      ).__conditionalPasskeyAutoResolve = true; // simulate "user taps the passkey in the dropdown"
    },
  });

describe('usernameless passkey discovery (fresh browser)', () => {
  // Warm Vite's dep optimization AND the hydrated client graph once (same rationale as
  // passkey-conditional.cy.ts, plus hydration: the discovery journey's first armed visit
  // is this spec's very first interaction, so any cold-load auto-reload would eat the
  // onBeforeLoad flags). Settle a fully hydrated page before any test-critical visit.
  before(() => {
    // Stage 1 — plain SSR visit: absorbs Vite's cold-start dep-optimization reload
    // (which would silently drop any onBeforeLoad flag) exactly like
    // passkey-conditional.cy.ts's warm-up.
    cy.visit('/id/login');
    cy.contains('button', /email/i);
    // Stage 2 — hydrated visit on the now-warm server: settles the full client
    // graph so the first test-critical armed visit isn't the first hydration.
    cy.visit('/id/login', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();
    cy.contains('button', /email/i);
  });

  it('fresh browser: BUTTON-initiated discovery signs in, then self-upgrades to the hinted path', () => {
    // 1. FRESH-browser preconditions: no hint, no session. Cleared individually —
    // cy.clearAllCookies() nukes Cypress-internal cookies too, and the next visit
    // loses its onBeforeLoad flags to an uninstrumented reload (repo convention:
    // passkey-conditional.cy.ts also clears specific cookies only).
    cy.clearCookie('passkey-hint');
    cy.clearCookie('sessions');
    // Ambient arming is hinted-only: a hintless load stays quiet
    // even with auto-resolve armed; the Passkey BUTTON is the discovery entry
    // (beginDiscovery — under Cypress the pre-baked credential IS the picked passkey).
    visitLoginArmed();
    cy.settleHydration();
    cy.location('pathname').should('eq', '/id/login');
    cy.contains('button', /passkey/i).click();
    cy.location('pathname').should('eq', '/id/signed-in');
    cy.contains(USER);

    // 2. Self-upgrade: the verify success wrote the hint (discover itself must not).
    cy.getCookie('passkey-hint').should('exist');

    // 3. Session expires (hint survives) → the returning visit takes the HINTED
    //    one-tap path — discovery ran at most once for this browser.
    cy.clearCookie('sessions');
    visitLoginArmed();
    cy.settleHydration();
    cy.location('pathname').should('eq', '/id/signed-in');
    cy.contains(USER);
  });

  it('a parked discovery ceremony (no tap) never blocks the ordinary identifier flow', () => {
    cy.clearCookie('passkey-hint');
    cy.clearCookie('sessions');
    cy.visit('/id/login', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true; // armed but NO auto-resolve → ceremony parks
      },
    });
    cy.settleHydration();
    cy.contains('button', /email/i).click();
    cy.get('input[name="loginName"]').type('alice@acme.test');
    cy.get('input[name="loginName"]:visible').closest('form').submit();
    // The identifier step's destination for any account with >= 1 usable method is the
    // /login/method chooser. What this test pins is that the ordinary submit WON — the URL
    // advanced off /id/login instead of the parked discovery ceremony swallowing it.
    cy.location('pathname').should('eq', '/id/login/method');
  });
});
