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
  it('gives illustration-1 explicit intrinsic dimensions + object-contain (no CLS, no crop)', () => {
    mountLayout();
    imgBySrcTail('images/illustration-1.svg')
      .should('have.attr', 'width', '707')
      .and('have.attr', 'height', '155')
      .and('have.class', 'object-contain');
  });

  it('gives illustration-2 explicit intrinsic dimensions + object-contain', () => {
    mountLayout();
    imgBySrcTail('images/illustration-2.svg')
      .should('have.attr', 'width', '232')
      .and('have.attr', 'height', '290')
      .and('have.class', 'object-contain');
  });

  it('gives the signature a fixed box + mask-contain (no CLS, crisp)', () => {
    mountLayout();
    // The signature is now a CSS-masked <span> (recoloured per theme), not an <img>: its box
    // is pinned by fixed w-24/h-[38px] classes and the asset rides in mask-image.
    cy.get('[style*="zac-sign.svg"]')
      .should('exist')
      .and('have.class', 'w-24')
      .and('have.class', 'h-[38px]');
    cy.get('[style*="zac-sign.svg"]')
      .should('have.attr', 'style')
      .and('match', /mask-size:\s*contain/i);
  });

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

describe('SplitLayout — 755-M4 dark-mode tokens', () => {
  it('uses semantic muted-foreground instead of hardcoded grey hex for the side-panel copy', () => {
    mountLayout();
    cy.get('body').invoke('html').should('not.include', '#67717C').and('not.include', '#595F65');
    cy.get('.text-muted-foreground').should('exist');
  });
});
