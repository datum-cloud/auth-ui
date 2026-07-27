import { checkA11y } from '../support/a11y';
import { extractCsrf, loginAndGetSession } from '../support/session';

// /id/passkeys — management journey (fake provider, real factor timestamps ⇒ sudo fresh).
// Order matters: the fake singleton persists across tests in one run — (b) removes mia's
// seeded row, (d) adds a fresh one.

// mia has TWO primary methods (password + passkey), so the identifier step routes to the
// /login/method chooser — loginAndGetSession leaves the session at the bare user check
// (never sudo-fresh). Complete the password factor via cy.request (deterministic; the
// password UI journey is core-signin.cy.ts's subject) so verifiedAt is stamped.
function signInMiaWithPassword() {
  loginAndGetSession('mia@acme.test');
  cy.request('/id/login/password?loginName=mia%40acme.test').then((resp) => {
    const csrf = extractCsrf(resp.body as string);
    cy.request({
      method: 'POST',
      url: '/id/login/password.data?loginName=mia%40acme.test',
      form: true,
      body: { csrf, loginName: 'mia@acme.test', password: 'hunter2' },
      followRedirect: false,
    });
  });
}

describe('/id/passkeys — list / remove / last-method guard / sign-out offer / add', () => {
  // Warm Vite's dep optimization once (mirrors core-signin.cy.ts): the first cold route
  // load triggers a hard reload that eats the first click/submit of a test. Also warm the
  // WebAuthn ceremony chunk with the existing u5 fixture (pre-existing cold-start flake —
  // passkey-use.cy.ts fails standalone on main the same way) so ceremony clicks land.
  before(() => {
    cy.visit('/id/login');
    cy.contains('button', 'Email');
    loginAndGetSession('passkey-user@acme.test');
    cy.visit('/id/login/passkey?loginName=passkey-user%40acme.test', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();
    cy.contains('button', /sign in with .*passkey|touch id|windows hello/i).should(
      'not.be.disabled'
    );
    cy.clearCookies();
  });

  it('(a) lists the seeded passkey without a state badge (sudo fresh after password login)', () => {
    signInMiaWithPassword();
    cy.visit('/id/passkeys', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true; // dialogs need JS (see entry.client.tsx)
      },
    });
    cy.settleHydration();
    cy.location('pathname').should('eq', '/id/passkeys');
    cy.contains('Seeded laptop').should('be.visible');
    // Active rows carry no state badge (no disable feature exists).
    cy.contains('Active').should('not.exist');
    // The seeded row predates created-at metadata — no Added line (no backfill).
    cy.contains('Added ').should('not.exist');
    checkA11y();
  });

  it('(b) remove flow: confirm dialog → row gone → sign-out-others offer → decline keeps the session', () => {
    signInMiaWithPassword();
    cy.visit('/id/passkeys', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();

    cy.get('button[aria-label="Remove Seeded laptop"]').should('not.be.disabled').click();
    cy.contains('Remove this passkey?').should('be.visible');
    cy.contains('button', 'Remove passkey').click();

    // Row gone + the sign-out dialog opens (modal instead of inline alert).
    cy.contains('Seeded laptop').should('not.exist');
    cy.contains('Passkey removed').should('be.visible');
    cy.contains('button', 'Sign out other sessions').should('be.visible');

    // Decline path: dialog closes in place; cookie/session untouched (no login bounce).
    cy.contains('button', 'Not now').click();
    cy.contains('Passkey removed').should('not.exist');
    cy.location('pathname').should('eq', '/id/passkeys');
    cy.contains('Passkeys').should('be.visible');
  });

  it('(c) passkey-only user: remove is refused (last method)', () => {
    // solo has no password — a REAL authentication factor must land on the session
    // (bare user-check never sudo-qualifies). Complete the passkey assertion via
    // cy.request (the loginAndGetSession pattern): the ceremony UI itself is covered by
    // passkey-use.cy.ts; this test's subject is the last-method guard.
    loginAndGetSession('solo@acme.test');
    cy.request('/id/login/passkey?loginName=solo%40acme.test').then((resp) => {
      const csrf = extractCsrf(resp.body as string);
      cy.request({
        method: 'POST',
        url: '/id/login/passkey.data?loginName=solo%40acme.test',
        form: true,
        body: {
          csrf,
          loginName: 'solo@acme.test',
          // The fake provider accepts any webAuthN assertion payload.
          credential: JSON.stringify({ id: 'fake-credential-id', type: 'public-key' }),
        },
        followRedirect: false,
      });
    });

    cy.visit('/id/passkeys', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();
    cy.location('pathname').should('eq', '/id/passkeys');

    // Last-method guard: refusal surfaces the inline error, the row stays.
    cy.get('button[aria-label="Remove Solo key"]').should('not.be.disabled').click();
    cy.contains('button', 'Remove passkey').click();
    cy.contains("You can't remove your only sign-in method").should('be.visible');
    cy.contains('Solo key').should('be.visible');
  });

  it('(d) add entry point: /setup/passkey round-trip returns to /id/passkeys with the new row', () => {
    signInMiaWithPassword();
    cy.visit('/id/passkeys', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true;
      },
    });
    cy.settleHydration();

    cy.contains('a', 'Add passkey').click();
    cy.location('pathname').should('eq', '/id/setup/passkey');
    // The Add link's return target points back at /passkeys.
    cy.location('search').should('contain', 'returnTo=%2Fpasskeys');

    // Complete the ceremony via cy.request (deterministic; the ceremony-click UI is
    // setup-passkey-mfa.cy.ts's subject). The action must prefer the posted returnTo
    // over the derived next step — asserted via the turbo-stream redirect below.
    const setupUrl = '/id/setup/passkey?loginName=mia%40acme.test&returnTo=%2Fpasskeys';
    cy.request(setupUrl).then((resp) => {
      const html = resp.body as string;
      const csrf = extractCsrf(html);
      const passkeyId = /name="passkeyId" value="([^"]+)"/.exec(html)?.[1] ?? '';
      cy.request({
        method: 'POST',
        url: '/id/setup/passkey.data?loginName=mia%40acme.test&returnTo=%2Fpasskeys',
        form: true,
        body: {
          csrf,
          loginName: 'mia@acme.test',
          passkeyId,
          returnTo: '/passkeys',
          credential: JSON.stringify({ id: 'fake-credential-id', type: 'public-key' }),
        },
        followRedirect: false,
      }).then((post) => {
        // returnTo wins over the derived next step.
        expect(String(post.body ?? '')).to.contain('"redirect","/passkeys"');
      });
    });

    // The round-trip lands back on /id/passkeys with the fresh row.
    cy.visit('/id/passkeys');
    cy.location('pathname').should('eq', '/id/passkeys');
    // (b) removed the seeded row, so the fresh enrollment is the only row.
    cy.get('ul li').should('have.length', 1);
    // The fake mirror stamps createdAt at verify — the fresh row shows today.
    const expectedDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date());
    cy.contains(`Added ${expectedDate}`).should('be.visible');
  });
});
