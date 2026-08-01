import { checkA11y } from '../support/a11y';
// Shared session-planting helper (posts the single-fetch `.data` endpoints). The old
// file-local copy document-POSTed /id/login, which now 405s (no action on the layout
// route) — every session it "planted" was silently empty.
import { extractCsrf, loginAndGetSession } from '../support/session';

// ─── Passkey enrollment (/setup/passkey) ─────────────────────────────────────

describe('Passkey enrollment (/setup/passkey)', () => {
  it('renders accessibly, drives attestation ceremony via Cypress path, redirects to /login/passkey', () => {
    // nofactor-user@acme.test has authMethods=['password'] only — suitable for enrollment.
    loginAndGetSession('nofactor-user@acme.test');

    // Ceremony screens need JS — opt into hydration (see entry.client.tsx).
    cy.visit('/id/setup/passkey?loginName=nofactor-user%40acme.test&checkAfter=true', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();

    checkA11y();

    // The WebAuthnButton (attestation mode) detects window.Cypress and uses the pre-baked credential.
    // Hydration gate: button is disabled until React mounts; Cypress actionability waits for it.
    cy.contains('button', /register passkey|enroll passkey|set up passkey/i)
      .should('not.be.disabled')
      .click();

    // Name step: the ceremony ran first; the name arrives pre-filled (UA fallback under
    // the pre-baked credential) with the scoping helptext, and Save submits credential+name.
    cy.contains(/Name your passkey/i).should('be.visible');
    cy.get('input[name="passkeyName"]').invoke('val').should('not.be.empty');
    cy.contains('your password manager labels it separately').should('be.visible');
    cy.contains("Names can't be changed later").should('be.visible');
    checkA11y();
    cy.contains('button', /^save$/i).click();

    // checkAfter=true → redirect into the matching passkey verify screen after enrollment.
    cy.location('pathname').should('eq', '/id/login/passkey');
  });

  it('threads passkeyName through enrollment and shows it on /id/passkeys', () => {
    // Dedicated namer@acme.test fixture — enrollments here never contaminate the
    // ordering-sensitive nofactor/mfa-skip users. The name field renders on the setup
    // screen; the SUBMIT is driven via cy.request (the ceremony-click UI path and the
    // client-side name pre-fill are covered by the route component spec —
    // setup-passkey-naming.cy.tsx — because WebAuthn ceremony clicks are
    // unreliable under the local dev-mode hydration recovery).
    loginAndGetSession('namer@acme.test');

    // The name field is on the page with its set-once helper copy.
    cy.visit('/id/setup/passkey?loginName=namer%40acme.test&returnTo=%2Fpasskeys');
    // Step 1 shows no name field — naming happens AFTER the ceremony. The
    // two-step UI (pre-fill, helptext, Save) is covered by the hydrated test above
    // and by cypress/component/routes/setup/setup-passkey-naming.cy.tsx.
    cy.get('input[name="passkeyName"]').should('not.exist');

    // Enrollment with a typed name → the exact name lands on the inventory row.
    const setupUrl = '/id/setup/passkey?loginName=namer%40acme.test&returnTo=%2Fpasskeys';
    cy.request(setupUrl).then((resp) => {
      const html = resp.body as string;
      const csrf = extractCsrf(html);
      const passkeyId = /name="passkeyId" value="([^"]+)"/.exec(html)?.[1] ?? '';
      cy.request({
        method: 'POST',
        url: '/id/setup/passkey.data?loginName=namer%40acme.test&returnTo=%2Fpasskeys',
        form: true,
        body: {
          csrf,
          loginName: 'namer@acme.test',
          passkeyId,
          returnTo: '/passkeys',
          passkeyName: 'My yubikey',
          credential: JSON.stringify({ id: 'fake-credential-id', type: 'public-key' }),
        },
        followRedirect: false,
      }).then((post) => {
        expect(String(post.body ?? '')).to.contain('"redirect","/passkeys"');
      });
    });

    cy.visit('/id/passkeys');
    cy.contains('ul li', 'My yubikey').should('be.visible');
  });
});

// ─── Security-key enrollment (/setup/security-key) ───────────────────────────

describe('Security-key enrollment (/setup/security-key)', () => {
  it('renders accessibly, drives attestation ceremony via Cypress path, redirects to /login/security-key', () => {
    loginAndGetSession('nofactor-user@acme.test');

    cy.visit('/id/setup/security-key?loginName=nofactor-user%40acme.test&checkAfter=true', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();

    checkA11y();

    cy.contains('button', /register security key|enroll security key|set up security key/i)
      .should('not.be.disabled')
      .click();

    cy.location('pathname').should('eq', '/id/login/security-key');
  });
});

// ─── MFA setup picker (/setup/mfa) ───────────────────────────────────────────

describe('MFA setup picker (/setup/mfa)', () => {
  it('renders accessibly, shows method links and Skip button when force=false, Skip resolves to /signed-in', () => {
    // mfa-skip-user@acme.test is a dedicated skip-only user seeded with authMethods=['password']
    // and never touched by other enrollment tests (which share the fake singleton). This avoids
    // the test-ordering hazard where nofactor-user accumulates enrolled factors (e.g. passkey)
    // across the suite. decideAfterIdentifier no longer names a per-method target — every
    // account with >= 1 usable method routes to /login/method — but the hazard is unchanged in
    // substance: loginAndGetSession completes the password factor only when password is the
    // account's ONLY method (see the CHOOSER HOP note in support/session.ts), so a contaminated
    // fixture silently stops getting its password step planted.
    loginAndGetSession('mfa-skip-user@acme.test');

    // No hydration opt-in needed: links + native form POST don't require JS.
    cy.visit('/id/setup/mfa?loginName=mfa-skip-user%40acme.test&force=false');

    checkA11y();

    // At least one method link must be rendered (fake capabilities enable passkey + totp + email).
    cy.get('a[href*="/setup/"]').should('have.length.greaterThan', 0);

    // Skip button is present when force=false.
    cy.contains('button[type="submit"]', /skip/i).should('be.visible');

    // Click Skip → setMfaInitSkipped stamps FIXED_NOW; nextStep with fresh skip → /signed-in.
    cy.contains('button[type="submit"]', /skip/i).click();

    cy.location('pathname').should('eq', '/id/signed-in');
  });

  it('does NOT show Skip button when force=true', () => {
    loginAndGetSession('mfa-skip-user@acme.test');

    cy.visit('/id/setup/mfa?loginName=mfa-skip-user%40acme.test&force=true');

    checkA11y();

    cy.contains('button[type="submit"]', /skip/i).should('not.exist');
  });
});

// ─── Guard: no session ────────────────────────────────────────────────────────

describe('Setup passkey/security-key/mfa — no session guard', () => {
  it('redirects to /login when visiting /setup/passkey without a session', () => {
    cy.visit('/id/setup/passkey?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });

  it('redirects to /login when visiting /setup/security-key without a session', () => {
    cy.visit('/id/setup/security-key?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });

  it('redirects to /login when visiting /setup/mfa without a session', () => {
    cy.visit('/id/setup/mfa?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });
});
