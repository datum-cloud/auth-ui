import { checkA11y } from '../../support/a11y';
import SplitLayout from '@/layouts/split.layout';
import { Button } from '@datum-cloud/datum-ui/button';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';

function mountLayout() {
  cy.mount(
    <ConformAdapter>
      <SplitLayout>
        <h1>Welcome to Datum</h1>
        <p>form</p>
        <Button htmlType="button">Continue</Button>
      </SplitLayout>
    </ConformAdapter>
  );
}

const formPanel = () => cy.contains('h1', 'Welcome to Datum').closest('main').parent();
const marketingPanel = () => cy.get('aside[aria-label="Datum overview"]');

// Helper: find a side-panel <img> whose src ends with the given tail.
function imgBySrcTail(tail: string) {
  return cy
    .get('img')
    .filter((_i, el) => (el.getAttribute('src') ?? '').endsWith(tail))
    .first()
    .should('exist');
}

describe('SplitLayout — 755-M3 side-panel imagery (CLS + crispness)', () => {
  it('keeps every decorative side-panel image dimensioned (CLS guard)', () => {
    mountLayout();
    for (const tail of ['images/illustration-1.svg', 'images/illustration-2.svg']) {
      imgBySrcTail(tail).invoke('attr', 'width').should('exist');
      imgBySrcTail(tail).invoke('attr', 'height').should('exist');
    }
    // Signature: a masked <span>, dimensioned by utility classes rather than width/height attrs.
    cy.get('[style*="zac-sign.svg"]').should('have.class', 'w-24').and('have.class', 'h-[38px]');
  });
});

describe('SplitLayout: one breakpoint for the grid and the marketing panel', () => {
  it('768px (tablet): the form fills the page and the marketing panel is not rendered', () => {
    cy.viewport(768, 1024);
    mountLayout();
    marketingPanel().should('not.be.visible');
    formPanel().should(($form) => {
      expect($form[0].getBoundingClientRect().width, 'form panel width').to.equal(768);
    });
    // Nothing stacks under the form, and nothing overflows sideways.
    cy.document().should((doc) => {
      expect(doc.documentElement.scrollHeight, 'page height').to.equal(1024);
      expect(doc.documentElement.scrollWidth, 'page width').to.equal(768);
    });
  });

  it('1023px: still the single-column form, one pixel under the breakpoint', () => {
    cy.viewport(1023, 800);
    mountLayout();
    marketingPanel().should('not.be.visible');
  });

  it('1024px: two equal columns, the marketing panel beside the form', () => {
    cy.viewport(1024, 768);
    mountLayout();
    marketingPanel().should('be.visible');
    formPanel().then(($form) => {
      const form = $form[0].getBoundingClientRect();
      marketingPanel().should(($aside) => {
        const aside = $aside[0].getBoundingClientRect();
        expect(form.width, 'form column').to.equal(512);
        expect(aside.width, 'marketing column').to.equal(512);
        expect(aside.left, 'panel starts where the form ends').to.equal(form.right);
        expect(aside.top, 'panel is beside the form, not under it').to.equal(form.top);
      });
    });
    cy.document().should((doc) => {
      expect(doc.documentElement.scrollWidth, 'page width').to.equal(1024);
    });
  });
});

describe('SplitLayout: theme-token surfaces and colour contrast', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: panels take the card and background tokens, and axe finds no contrast violation`, () => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      cy.viewport(1024, 768);
      mountLayout();
      const probe = (token: string) => {
        const el = document.createElement('div');
        el.style.backgroundColor = `var(${token})`;
        document.body.appendChild(el);
        const colour = getComputedStyle(el).backgroundColor;
        el.remove();
        return colour;
      };
      formPanel().should(($form) => {
        expect(getComputedStyle($form[0]).backgroundColor).to.equal(probe('--card'));
      });
      marketingPanel().should(($aside) => {
        expect(getComputedStyle($aside[0]).backgroundColor).to.equal(probe('--background'));
      });
      checkA11y('[data-cy-root]');
    });
  }
});
