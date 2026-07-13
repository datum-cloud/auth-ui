import SplitLayout from '@/layouts/split.layout';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';

function mountLayout() {
  cy.mount(
    <ConformAdapter>
      <SplitLayout>
        <p>form</p>
      </SplitLayout>
    </ConformAdapter>
  );
}

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
