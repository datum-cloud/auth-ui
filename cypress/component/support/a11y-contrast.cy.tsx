// cypress/component/support/a11y-contrast.cy.tsx
//
// Pins the shared a11y helper's colour-contrast behaviour: the rule is ON, and the only
// elements it skips are the listed exemptions (see CONTRAST_EXEMPT_SELECTORS in
// cypress/support/a11y.ts). Without this, a selector typo could silently switch the rule
// off for everything and every contrast check would pass vacuously.
import { configureContrastExemptions } from '../../support/a11y';
import { Button } from '@datum-cloud/datum-ui/button';
import type { Result } from 'axe-core';

type AxeWindow = { axe: { run: (context: string) => Promise<{ violations: Result[] }> } };

function contrastViolations() {
  cy.injectAxe();
  configureContrastExemptions();
  return cy
    .window()
    .then((win) => (win as unknown as AxeWindow).axe.run('[data-cy-root]'))
    .then(({ violations }) =>
      violations
        .filter((violation) => violation.id === 'color-contrast')
        .flatMap((violation) => violation.nodes.map((node) => node.target.join(' ')))
    );
}

function mountSample() {
  cy.mount(
    <div style={{ background: '#ffffff', padding: 16 }}>
      <p id="low-contrast" style={{ color: '#999999' }}>
        Grey text on white is 2.85:1
      </p>
      <p id="fine" style={{ color: '#111111' }}>
        Near-black text on white
      </p>
      <Button htmlType="button">Primary</Button>
    </div>
  );
}

describe('checkA11y colour contrast', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('light: reports low-contrast text and skips only the exempt primary button', () => {
    mountSample();
    contrastViolations().should('deep.equal', ['#low-contrast']);
  });

  it('dark: the primary button is not exempt and passes on its own', () => {
    document.documentElement.classList.add('dark');
    mountSample();
    contrastViolations().should('deep.equal', ['#low-contrast']);
  });
});
