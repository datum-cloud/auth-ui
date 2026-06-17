import { checkA11y } from '../support/a11y';

/**
 * P5 Task 14 — two sessions → /accounts → switch
 *
 * switch-a@acme.test and switch-b@acme.test have authMethods=['password'] only
 * (seeded in select.server.ts). Both complete login without any 2nd factor so they
 * land fully authenticated (nextStep → /signed-in).
 *
 * Dedicated seed users are used so the account-switch spec does not share session
 * state with any enrollment spec (the fake is a singleton across the full suite run).
 *
 * Interaction style: cy.request for session setup (native POST, no hydration needed),
 * then cy.visit for the /accounts screen, then native form.submit() for the switch.
 * Pattern copied from setup-otp.cy.ts loginAndGetSession helper.
 */

const FAKE_PASSWORD = 'hunter2';

/**
 * Decode HTML entities in attribute values (React SSR escapes & → &amp; etc.).
 * Required before round-tripping a CSRF token extracted from SSR HTML.
 */
function extractCsrf(html: string): string {
  const raw = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

/**
 * Drives identifier → password via cy.request (no browser UI).
 * Both set-cookie responses accumulate in the shared Cypress cookie jar so
 * subsequent cy.visits will carry both sessions in the `sessions` cookie.
 */
function loginAndGetSession(loginName: string) {
  cy.request('/id/login').then((resp) => {
    const csrf = extractCsrf(resp.body as string);
    cy.request({
      method: 'POST',
      url: '/id/login',
      form: true,
      body: { csrf, loginName },
      followRedirect: false,
    }).then((post) => {
      const target = String(post.headers.location ?? '');
      if (target.includes('/login/password')) {
        // The redirect may be absolute or relative; normalise to a path the server handles.
        const pwPageUrl = target.startsWith('http')
          ? target
          : `/id${target.startsWith('/id') ? target.slice(3) : target}`;
        cy.request(pwPageUrl).then((pwPage) => {
          const pwCsrf = extractCsrf(pwPage.body as string) || csrf;
          cy.request({
            method: 'POST',
            url: target,
            form: true,
            body: { csrf: pwCsrf, loginName, password: FAKE_PASSWORD },
            followRedirect: false,
          });
        });
      }
    });
  });
}

describe('account switcher — two sessions', () => {
  it('shows two account cards, switches to the second, lands on /signed-in', () => {
    // Plant two fully-authenticated sessions in the cookie jar.
    loginAndGetSession('switch-a@acme.test');
    loginAndGetSession('switch-b@acme.test');

    // Visit /accounts — both sessions should now appear.
    cy.visit('/id/accounts');

    // Accessibility check on the account picker screen (CCD-5).
    checkA11y();

    // Assert two account cards are rendered.
    cy.get('[class*="rounded-lg border"]').should('have.length.gte', 2);

    // The second account card's Switch button switches to switch-b.
    // Both accounts are fully active (nextStep → /signed-in for password-only users).
    // Click the Switch button on the card for switch-b (second in list order).
    cy.contains('switch-b@acme.test')
      .closest('[class*="rounded-lg border"]')
      .within(() => {
        cy.get('button[type="submit"]').first().click();
      });

    // Switching a fully-active session redirects to /signed-in.
    cy.location('pathname').should('eq', '/id/signed-in');
  });
});
