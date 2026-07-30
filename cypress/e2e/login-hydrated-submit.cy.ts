import { checkA11y } from '../support/a11y';

/**
 * REGRESSION (see entry.client.tsx + root.tsx hydration notes):
 *
 * The prior React-Hook-Form adapter intercepted the form's submit event on a
 * HYDRATED page and never let the native POST fire — the identifier form looked
 * alive but silently swallowed the click. The rest of the Cypress suite never
 * caught this because the dual-mode gate runs those specs with hydration OFF
 * (`skipHydration`), where the browser performs a plain native POST and the
 * adapter is never in the loop.
 *
 * This spec deliberately OPTS INTO hydration (`__CYPRESS_HYDRATE__ = true` +
 * cy.settleHydration(), mirroring passkey-use.cy.ts) so React owns the form, then
 * asserts the form ACTUALLY submits when a hydrated user clicks Continue:
 *   1. a POST to /id/login is observed and the action redirects (302/303 —
 *      cy.intercept yields the redirect response itself without following it), AND
 *   2. the URL advances off /id/login to the password screen.
 *
 * Runs in the FAST suite (fake provider) and reuses the exact seeded user the
 * core-signin spec uses (alice@acme.test → /id/login/password). No live Zitadel.
 *
 * If the RHF-style "swallow the submit" regression returns, the POST interception
 * never fires and the location assertion stays on /id/login — both fail.
 */
describe('login form submits when hydrated (RHF-adapter regression)', () => {
  it('POSTs and advances off /id/login after a hydrated Continue click', () => {
    // cy.intercept yields the POST's OWN response and does NOT follow redirects
    // before yielding (per @types/cypress net-stubbing.d.ts), so we inspect the
    // login action's own 302/303 rather than the final 200 of the /id/login/password
    // GET. NOTE: { followRedirect: false } is NOT a valid intercept option — it is a
    // cy.request option; passing it here would be treated as a StaticResponse stub
    // that silently replaces the real server response, so it is deliberately omitted.
    cy.intercept('POST', '**/id/login*').as('identifierPost');

    cy.visit('/id/login', {
      onBeforeLoad: (win) => {
        win.__CYPRESS_HYDRATE__ = true; // hydrate so React owns the form (see entry.client.tsx)
      },
    });
    cy.settleHydration(); // force React's lazy/Cypress-mismatch regeneration to settle first

    checkA11y(); // hydrated /login still renders accessibly

    // IdP-first UX: the identifier field is hidden behind an "Email" reveal button (see
    // entry.client.tsx + routes/login/index.tsx). Click it first to mount the loginName input —
    // mirrors core-signin.cy.ts. (Pre-IdP-first this field was visible on load; the reveal is the
    // current behavior.) The hydration regression this spec guards is unaffected by the reveal.
    cy.contains('button', 'Continue with email').click();

    // Type into the (now React-controlled) identifier field and click the real
    // Continue button — the exact interaction the RHF adapter used to swallow.
    cy.get('input[name="loginName"]').type('alice@acme.test');
    cy.contains('button', /continue/i).click();

    // 1) The form's POST must actually fire. A HYDRATED React Router <Form> submits via
    //    single-fetch (POST /id/login.data → 202 + a client-side navigation), whereas a
    //    NATIVE (non-hydrated) POST returns a 302/303 redirect. Accept both — the real
    //    regression signal is that the POST fired at all (a swallowed submit means NO POST)
    //    and that the ceremony advances (asserted below). 202/302/303, never a non-redirect 200.
    cy.wait('@identifierPost').its('response.statusCode').should('be.oneOf', [202, 302, 303]);

    // 2) And the ceremony must advance — alice resolves to the password screen.
    cy.location('pathname').should('eq', '/id/login/password');
  });
});
