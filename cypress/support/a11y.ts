import type { Result } from 'axe-core';
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
//
// COLOR CONTRAST is checked (WCAG AA) everywhere except the selectors below. Each entry is
// a known, real violation that auth-ui cannot fix locally; the rule stays on for everything
// else, so a new low-contrast element fails the gate. Delete an entry once its cause is fixed.
const CONTRAST_EXEMPT_SELECTORS = [
  // All three are datum-ui alpha-theme colour tokens that miss AA (4.5:1) in the LIGHT
  // theme only. root.css takes those tokens unmodified, so the fix is upstream in datum-ui.
  // The dark theme passes for each of them and is not exempt.
  //
  // Solid primary button: white text on --btn-primary (#a68686) is 3.29:1.
  'html:not(.dark) .bg-btn-primary',
  // --primary as a text colour (#9c7979 on white is 3.87:1): datum-ui's link-theme and
  // outline/borderless primary buttons, e.g. BackLink.
  'html:not(.dark) .text-primary',
  // --destructive as a text colour (#d25b5b on the page background is 3.6:1): FormError
  // and the other inline error messages.
  'html:not(.dark) .text-destructive',
];

const CONTRAST_EXEMPT = CONTRAST_EXEMPT_SELECTORS.flatMap((selector) => [
  selector,
  `${selector} *`,
]).join(', ');

/** Narrows ONLY the color-contrast rule; every other rule still sees the exempt elements. */
export function configureContrastExemptions() {
  cy.configureAxe({ rules: [{ id: 'color-contrast', selector: `*:not(${CONTRAST_EXEMPT})` }] });
}

/**
 * Fails with every violation spelled out (rule, element, axe's reason). cypress-axe alone
 * reports only a count in the terminal, which is not enough to fix a failure or to scope
 * an exemption. Works the same in component and e2e runs.
 */
export function failWithViolations(violations: Result[]) {
  const lines = violations.flatMap((violation) =>
    violation.nodes.map((node) => {
      const reason = node.any[0]?.message ?? node.failureSummary ?? '';
      return `${violation.id}: ${node.target.join(' ')}\n    ${node.html}\n    ${reason}`;
    })
  );
  throw new Error(`${lines.length} accessibility violation(s):\n  ${lines.join('\n  ')}`);
}

/** Runs axe on the page, or on `context` (a selector) when a component spec mounts a fragment. */
export function checkA11y(context?: string) {
  cy.injectAxe();
  configureContrastExemptions();
  cy.checkA11y(context, undefined, failWithViolations);
}
