import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Shared axe assertion for the ceremony/auth component a11y guard.
 *
 * Runs axe-core's STRUCTURAL/ARIA ruleset against a rendered container and
 * asserts zero violations. `color-contrast` is disabled here because it is a
 * BROWSER-ONLY check (it needs real layout + computed colors that happy-dom does
 * not provide) — contrast is instead covered by the one-time live `cypress-axe`
 * accessibility checks and the Playwright visual baseline.
 *
 * On failure the rule ids + offending node HTML are surfaced so the assertion is
 * actionable rather than a bare "expected 1 to equal 0".
 */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.html),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

/**
 * Compute the keyboard tab order of a container in DOM document order.
 *
 * happy-dom does not implement the browser's automatic Tab focus engine (a
 * `keyDown('Tab')` event does not move focus), so we derive the tabbable
 * sequence structurally — the SAME order a browser would follow when no positive
 * tabindex is present (the recommended, trap-free pattern). Elements with a
 * positive tabindex (a focus-order foot-gun) are surfaced separately so a test
 * can assert their absence.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function tabbableOrder(container: Element): HTMLElement[] {
  const els = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return els.filter((el) => {
    const ti = el.getAttribute('tabindex');
    return ti === null || Number(ti) >= 0;
  });
}

/** Elements with a positive tabindex — these break natural focus order if present. */
export function positiveTabindexElements(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[tabindex]')).filter(
    (el) => Number(el.getAttribute('tabindex')) > 0
  );
}
