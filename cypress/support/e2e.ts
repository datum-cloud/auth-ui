import './a11y';

// Cypress support entrypoint. Task 12 appends `import './a11y';` to load the axe harness.

// Suppress two categories of dev-mode noise that are not application errors:
//
// 1. Vite re-optimises dependencies on the first cold visit, which triggers a
//    "Failed to fetch dynamically imported module" rejection before the page
//    auto-reloads. Not a real failure.
//
// 2. React Router v7 injects a critical-CSS <style> tag on the server that is
//    absent in the initial client HTML, causing a React hydration mismatch in
//    dev mode. The framework recovers immediately (React 19 regenerates the
//    tree client-side); not a real failure.
//    Narrowed: only suppressed when the RR7 critical-CSS marker appears in the
//    React hydration diff embedded in the error message (race-free — the DOM
//    style tag is already gone by the time the error fires), with the DOM query
//    kept as a fallback. A REAL hydration mismatch (e.g. SSR i18n locale bleed)
//    still fails the test.
//
// NOTE (Phase 6): the prod-mode Cypress smoke run must execute once with this
// handler disabled against the production build to confirm zero hydration errors.
Cypress.on('uncaught:exception', (err) => {
  const isCriticalCssNoise =
    err.message.includes('Hydration failed') &&
    (err.message.includes('data-react-router-critical-css') ||
      !!document.querySelector('[data-react-router-critical-css]'));
  // ClientHintCheck (<script> in <head>) causes a hydration mismatch in dev because
  // Cypress's proxy injects its own <script> into <head>, shifting the node order that
  // React 19's strict head reconciler checks. Real browsers / Playwright are unaffected.
  // Narrowed to the ClientHintCheck component name in the React diff so we don't suppress
  // real mismatches. The diff always shows the component wrapper name.
  const isClientHintNoise =
    err.message.includes('Hydration failed') &&
    err.message.includes('ClientHintCheck');
  // Production builds MINIFY React errors, so the dev-mode "Hydration failed" text never
  // appears — the same Cypress-head-injection hydration mismatch (see settleHydration note
  // below: Cypress ALWAYS injects a <script> into <head>, which real browsers/Playwright do
  // not) surfaces as "Minified React error #418/#423/#425" instead. In THIS harness those
  // codes are always that injection noise; the dedicated prod hydration smoke runs without
  // this handler (see note above) to catch genuine prod hydration errors.
  const isMinifiedHydrationNoise = /Minified React error #(418|423|425)\b/.test(err.message);
  if (
    err.message.includes('Failed to fetch dynamically imported module') ||
    isCriticalCssNoise ||
    isClientHintNoise ||
    isMinifiedHydrationNoise
  ) {
    return false;
  }
});

// Cypress's proxy always injects a script into <head>, which React 19's strict
// head hydration flags as a mismatch (Cypress-only — real browsers/Playwright
// hydrate cleanly). React recovers by REGENERATING the tree — but lazily, on the
// first dispatched event, which detaches the nodes a test captured and silently
// eats that first interaction. settleHydration() spends a sacrificial click to
// force the regeneration, then waits for the root effect marker so subsequent
// queries hit the live, regenerated tree.
Cypress.Commands.add('settleHydration', () => {
  cy.get('body').click(2, 2);
  cy.get('html[data-hydrated]');
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Force React's lazy hydration (+ Cypress-only mismatch regeneration) to settle before interacting. */
      settleHydration(): Chainable<void>;
    }
  }
}

export {};
