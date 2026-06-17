import 'cypress-axe';

// KNOWN BLIND SPOT: axe classifies equal foreground/background (1:1 contrast) as
// "incomplete", NOT a violation — invisible text passes this check AND Lighthouse's
// a11y category (also axe-based). Phase 7's manual audit must verify visual contrast.
//
// WCAG 2.2 AUTOMATED COVERAGE GAP: axe-core 4.12 implements only `target-size`
// from the new WCAG 2.2 criteria. The following criteria have NO automated axe rule
// and are therefore NOT covered by checkA11y() — they are deferred to the Phase 7
// Task 4 manual audit:
//   • 2.4.11 Focus Appearance (minimum)
//   • 2.5.7 Dragging Movements
//   • 3.2.6 Consistent Help
export function checkA11y() {
  cy.injectAxe();
  cy.checkA11y(undefined, { rules: { 'color-contrast': { enabled: true } } });
}
