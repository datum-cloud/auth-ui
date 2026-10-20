// cypress/e2e/passkey-discovery.cy.ts
//
// The usernameless DISCOVERY path end-to-end against the fake provider, with REAL WebAuthn
// ceremonies on Chrome's virtual authenticator: a FRESH browser — no passkey-hint, no
// session — signs in with zero typing. The Passkey button runs a first assertion that is
// posted to /login/passkey-discover (only its userHandle is read: it resolves u5 and mints a
// user-bound challenge), then a second assertion goes to /login/passkey, where the fake
// provider verifies the signature. The verify success writes the hint, so the next visit
// takes the one-tap HINTED path (browser self-upgrade, at-most-once-per-browser discovery).
import { PASSKEY_U5 } from '../fixtures/passkey-u5';
import {
  addVirtualAuthenticator,
  expectPostedRealCredential,
  plantCredential,
  removeVirtualAuthenticator,
  setAutomaticPresenceSimulation,
  visitRealWebAuthn,
} from '../support/virtual-authenticator';

const USER = 'passkey-user@acme.test'; // u5 — the seeded passkey user

describe('usernameless passkey discovery (fresh browser)', () => {
  let authenticatorId: string;

  // Warm Vite's dep optimization AND the hydrated client graph once (same rationale as
  // passkey-conditional.cy.ts, plus hydration: any cold-load auto-reload would eat the
  // onBeforeLoad flags of the first test-critical visit).
  before(() => {
    cy.visit('/id/login');
    cy.contains('button', /email/i);
    cy.visit('/id/login', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();
    cy.contains('button', /email/i);
  });

  beforeEach(() => {
    addVirtualAuthenticator().then((id) => {
      authenticatorId = id;
      plantCredential(id, PASSKEY_U5);
    });
  });

  afterEach(() => {
    if (authenticatorId) removeVirtualAuthenticator(authenticatorId);
    authenticatorId = '';
  });

  it('fresh browser: BUTTON-initiated discovery signs in, then self-upgrades to the hinted path', () => {
    // FRESH-browser preconditions: no hint, no session. Cleared individually —
    // cy.clearAllCookies() nukes Cypress-internal cookies too.
    cy.clearCookie('passkey-hint');
    cy.clearCookie('sessions');
    cy.intercept('POST', /\/id\/login\/passkey-discover(\.data)?(\?|$)/).as('discover');
    cy.intercept('POST', /\/id\/login\/passkey(\.data)?(\?|$)/).as('verify');

    // Ambient arming is hinted-only: a hintless load stays quiet; the Passkey BUTTON is the
    // discovery entry.
    visitRealWebAuthn('/id/login');
    cy.location('pathname').should('eq', '/id/login');
    cy.contains('button', /passkey/i).click();
    cy.location('pathname').should('eq', '/id/signed-in');
    cy.contains(USER);

    // Both assertions came from the planted credential, not the pre-baked shortcut one.
    for (const alias of ['@discover', '@verify'])
      expectPostedRealCredential(alias, authenticatorId);

    // Self-upgrade: the verify success wrote the hint (discover itself must not).
    cy.getCookie('passkey-hint').should('exist');

    // Session expires (hint survives) → the returning visit takes the HINTED one-tap path —
    // discovery ran at most once for this browser.
    cy.clearCookie('sessions');
    visitRealWebAuthn('/id/login');
    cy.location('pathname').should('eq', '/id/signed-in');
    cy.contains(USER);
  });

  it('a parked discovery ceremony (no tap) never blocks the ordinary identifier flow', () => {
    cy.clearCookie('passkey-hint');
    cy.clearCookie('sessions');
    // No presence: any ceremony that starts parks instead of resolving.
    setAutomaticPresenceSimulation(authenticatorId, false);
    visitRealWebAuthn('/id/login');
    cy.contains('button', /email/i).click();
    cy.get('input[name="loginName"]').type('alice@acme.test');
    cy.get('input[name="loginName"]:visible').closest('form').submit();
    // The identifier step's destination for any account with >= 1 usable method is the
    // /login/method chooser. What this test pins is that the ordinary submit WON — the URL
    // advanced off /id/login instead of the parked discovery ceremony swallowing it.
    cy.location('pathname').should('eq', '/id/login/method');
  });
});
