import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

// With the per-request Lingui i18n instance pattern (locale + messages come from
// the root loader's serialized data), there is no need to pre-activate a global
// catalog before hydration. The root App component receives locale+messages via
// useLoaderData and builds a scoped i18n instance via setupI18n — hydration
// picks it up automatically.

// Cypress dual-mode: the Cypress proxy injects a node into <head>, which React
// 19's strict head hydration flags as a mismatch; the recovery regenerates the
// tree mid-interaction and silently eats clicks/submits (real browsers and
// Playwright hydrate cleanly — verified). Specs that only need SSR + native
// form posts therefore run WITHOUT hydration (the regime they were written
// for); specs that need JS (e.g. WebAuthn ceremonies) opt in via
// `cy.visit(url, { onBeforeLoad: (win) => { win.__CYPRESS_HYDRATE__ = true } })`
// together with cy.settleHydration().
declare global {
  interface Window {
    Cypress?: unknown;
    __CYPRESS_HYDRATE__?: boolean;
  }
}
const skipHydration = typeof window.Cypress !== 'undefined' && !window.__CYPRESS_HYDRATE__;

if (!skipHydration) {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <HydratedRouter />
      </StrictMode>
    );
  });
}
