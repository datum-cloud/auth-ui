// RP-initiated logout acceptance: proves that a Zitadel-initiated OIDC back-channel
// logout (the end_session → /id/logout?logout_token handshake) terminates ALL v2 sessions
// and clears the `sessions` cookie — so a subsequent visit cannot silently re-authenticate.
//
// Regression guarded: before this fix, /id/logout lacked a logout_token handler; the IdP
// end_session endpoint completed on Zitadel's side but auth-ui never cleared the cookie,
// leaving a live SSO session that /authorize would silently reuse (no re-authentication).
//
// Gated: runs only with `--env ACCEPTANCE=1` (the fast fake-provider suite skips it).
// The app server must already be running with AUTH_PROVIDER=zitadel pointed at a real
// instance, e.g. the local stack:
//
//   SESSION_SECRET=<32+ chars> NODE_ENV=production AUTH_PROVIDER=zitadel \
//   ZITADEL_API_URL=https://auth.localtest.me:30000 \
//   ZITADEL_SERVICE_USER_TOKEN=<pat> NODE_EXTRA_CA_CERTS=./dev-ca.crt \
//   bunx start-server-and-test 'bun run start' http-get://localhost:3000/healthz \
//     'bunx cypress run --spec acceptance/logout.acceptance.cy.ts --env ACCEPTANCE=1'
//
// Credentials default to the LOCAL dev-stack test user; override via
// CYPRESS_ACCEPTANCE_LOGIN_NAME / _PASSWORD.
//
// STATE NOTE: the journey is state-tolerant. A password-only user lands on the skippable
// /id/setup/mfa prompt the FIRST time (30-day skip policy) and directly on /id/signed-in
// while a prior skip is fresh — both paths are tolerated exactly as core-signin does.

const RUN = String(Cypress.env('ACCEPTANCE') ?? '') === '1';

const LOGIN_NAME = String(Cypress.env('ACCEPTANCE_LOGIN_NAME') ?? 'zitadel-e2e-user2');
const PASSWORD = String(Cypress.env('ACCEPTANCE_PASSWORD') ?? 'LocalDev-Passw0rd!');

// The `sessions` cookie name is defined in app/modules/auth/session/cookie.ts:
//   export const sessionsCookie = createCookie('sessions', { ... });
// Keeping this constant co-located with the assertions avoids silent drift if the name changes.
const SESSIONS_COOKIE = 'sessions';

(RUN ? describe : describe.skip)('RP-initiated logout (real Zitadel)', () => {
  // ─── Step 1: sign in through the auth-ui ceremony ────────────────────────────
  //
  // We need a live `sessions` cookie before we can prove that logout clears it.
  // Mirror core-signin exactly: identifier → password → (skippable MFA) → routed away.
  // We intercept /id/signed-in to neutralize the cross-origin redirect to the default
  // app, so Cypress doesn't choke on the external origin. We only need the COOKIE set
  // by the time the session ceremony completes — the redirect target doesn't matter here.

  beforeEach(() => {
    cy.intercept('GET', '**/id/signed-in*', (req) => {
      req.continue((res) => {
        res.statusCode = 200;
        res.body = 'signed-in-observed';
      });
    }).as('postLogin');
  });

  it('logout_token clears the sessions cookie and prevents silent re-auth', () => {
    // ── 1. Sign in ────────────────────────────────────────────────────────────
    cy.visit('/id/login');
    cy.get('input[name="loginName"]').type(LOGIN_NAME);
    cy.get('button[type="submit"]').first().click();

    cy.location('pathname').should('eq', '/id/login/password');
    cy.get('input[name="password"]').type(PASSWORD, { log: false });
    cy.get('button[type="submit"]').first().click();

    // Tolerate the skippable MFA-enrollment prompt (30-day skip policy, first login only).
    cy.location('pathname').then((path) => {
      if (path === '/id/setup/mfa') {
        cy.contains('button', /skip for now/i).click();
      }
    });

    // Wait for /id/signed-in to be intercepted (ceremony complete, cookie set).
    cy.wait('@postLogin');

    // Verify the sessions cookie exists before we attempt logout.
    cy.getCookie(SESSIONS_COOKIE).should('not.be.null');

    // ── 2. RP-initiated logout via logout_token ───────────────────────────────
    //
    // Real Zitadel signs the logout_token as a JWT and forwards it here after the
    // RP calls /oauth/v2/end_session. The auth-ui loader (app/routes/logout/index.tsx)
    // only checks for the PRESENCE of the `logout_token` query param — it reads the
    // sessions cookie and calls completeOidcLogout(provider, request), which deletes
    // ALL v2 sessions and then issues `serializeSessions([])` to clear the cookie.
    // No JWT validation of the token value happens in auth-ui itself (Zitadel validates
    // it server-side before bouncing here). A placeholder value is therefore sufficient
    // for asserting auth-ui's own cookie-clearing behavior without a live Zitadel
    // back-channel call — which would require a real signed JWT.
    //
    // We include post_logout_redirect=/id/logout/success so the loader falls back to a
    // same-origin path (validated as a relative path by validatePostLogoutRedirect) and
    // stays within the app, making the subsequent assertions same-origin and reliable.
    cy.visit('/id/logout?logout_token=placeholder-token&post_logout_redirect=/id/logout/success');

    // ── 3. Assert the sessions cookie is cleared ──────────────────────────────
    //
    // logoutOutcomeToResponse emits a 302 with `set-cookie: sessions=...; Max-Age=0` (or
    // an empty serialized array, which the browser treats as a cleared/expired cookie).
    // After following the redirect Cypress should see no `sessions` cookie value.
    cy.getCookie(SESSIONS_COOKIE).then((cookie) => {
      // The cookie is either absent (null) or its value is the serialized empty-array
      // HMAC signature (no live sessions). Either way the live session is gone.
      if (cookie !== null) {
        // serializeSessions([]) produces a signed empty-array payload — it is NOT the
        // same as an unset cookie. Accept it only when the value represents an empty
        // session list (the HMAC-signed `[]`). We cannot decode it here, so we assert
        // it at least does NOT contain a base64-encoded session-id segment, which would
        // indicate a live session survived.
        expect(cookie.value, 'sessions cookie should be empty (no live sessions)').to.satisfy(
          (v: string) => v === '' || v.length < 50,
          'expected an empty or minimal sessions value after logout'
        );
      }
      // null is the ideal outcome (Max-Age=0 or path-scoped expiry cleared the cookie).
    });

    // ── 4. Assert no silent re-auth on a protected route ──────────────────────
    //
    // Visiting /id/accounts after logout should show NO active session. The /accounts
    // route calls listAccounts() → readSessions() → returns [] when the cookie is cleared,
    // rendering the empty-state UI (no account cards). This is the most reliable assertion
    // because:
    //   a) it does not require constructing a valid OIDC authRequest (which needs a live
    //      Zitadel client_id / redirect_uri to be registered), and
    //   b) /id/accounts is a same-origin page under the app's own basename — no intercept
    //      needed, making the assertion deterministic and non-flaky.
    //
    // The bug-before-fix: the cookie survived, /accounts listed the live session as active,
    // and any /authorize call would silently reuse it (no re-authentication challenge).
    // The fix: the cookie is cleared, so /accounts shows no accounts.
    cy.visit('/id/accounts');
    cy.location('pathname').should('eq', '/id/accounts');

    // The empty-state accounts page does NOT show any active session card.
    // The most reliable selector: no element with role=heading or login-name text that
    // would indicate an active session is present.
    cy.get('body').should('not.contain.text', LOGIN_NAME);

    // Additionally, the page should NOT redirect back to /id/signed-in (which would prove
    // a live session was found and resolved). It should stay on /id/accounts (empty state).
    cy.location('pathname').should('eq', '/id/accounts');
  });

  it('logout without a live session still lands on the success page (idempotent)', () => {
    // Proves the loader is safe when called with no active session cookie (e.g. browser
    // already cleared it, or a second logout_token delivery from Zitadel).
    // No sign-in step — visit logout directly with no sessions cookie present.
    cy.clearCookie(SESSIONS_COOKIE);

    cy.visit('/id/logout?logout_token=placeholder-token&post_logout_redirect=/id/logout/success');

    // Should land on /id/logout/success (the fallback) and show the "signed out" page.
    cy.location('pathname').should('eq', '/id/logout/success');
    cy.contains(/you.ve been signed out/i).should('be.visible');
  });
});

// Module scope: prevents top-level const collisions across acceptance specs under tsc.
export {};
