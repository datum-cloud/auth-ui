import { checkA11y } from '../support/a11y';

// axe / WCAG 2.2 AA per-screen gate (INDEX §C, CCD-5)

// Screens not on a happy-path journey above — render-only axe coverage.
describe('Phase 2 standalone screens — a11y', () => {
  it('/password/change passes axe', () => {
    cy.visit('/id/password/change'); // forced-change screen (session-gated; render-only)
    checkA11y();
  });
  it('/verify/success passes axe', () => {
    cy.visit('/id/verify/success?userId=u1&loginName=alice@acme.test');
    checkA11y();
  });
});
