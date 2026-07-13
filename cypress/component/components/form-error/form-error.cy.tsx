import { FormError } from '@/components/form-error/form-error';

describe('FormError', () => {
  it('renders children inside an assertive alert region, and renders nothing when there are no children', () => {
    cy.mount(<FormError>Something went wrong</FormError>);
    cy.findByRole('alert')
      .should('have.attr', 'aria-live', 'assertive')
      .and('contain.text', 'Something went wrong');

    cy.mount(<FormError>{null}</FormError>);
    cy.get('[role="alert"]').should('not.exist');
  });
});
