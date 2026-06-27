import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { CsrfInput } from '@/components/auth-form/csrf-input';
import { LastUsedBadge } from '@/components/auth-form/last-used-badge';
import { CSRF_FORM_KEY } from '@/shared';

// Helper: collect all hidden inputs as {name, value} pairs.
function getHiddenInputs() {
  return cy.get('input[type=hidden]').then(($inputs) =>
    Cypress.$.makeArray($inputs).map((el) => ({
      name: el.getAttribute('name'),
      value: el.getAttribute('value'),
    }))
  );
}

describe('CsrfInput', () => {
  it('renders the csrf hidden input with CSRF_FORM_KEY and the token', () => {
    cy.mount(<CsrfInput token="tok-123" />);
    getHiddenInputs().should('deep.equal', [{ name: CSRF_FORM_KEY, value: 'tok-123' }]);
  });
});

describe('AuthFormFields', () => {
  it('renders only csrf when no identity props are given', () => {
    cy.mount(<AuthFormFields csrf="t" />);
    getHiddenInputs().should('deep.equal', [{ name: 'csrf', value: 't' }]);
  });

  it('renders csrf + identity inputs in fixed order, skipping undefined', () => {
    cy.mount(
      <AuthFormFields csrf="t" loginName="a@b.test" requestId="r1" next="/login/password" />
    );
    getHiddenInputs().should('deep.equal', [
      { name: 'csrf', value: 't' },
      { name: 'loginName', value: 'a@b.test' },
      { name: 'requestId', value: 'r1' },
      { name: 'next', value: '/login/password' },
    ]);
  });
});

describe('LastUsedBadge', () => {
  it('returns null when inactive', () => {
    cy.mount(<LastUsedBadge active={false} />);
    // Component returns null — [data-cy-root] should contain no child elements.
    cy.get('[data-cy-root]').children().should('have.length', 0);
  });

  it('renders something when active', () => {
    cy.mount(<LastUsedBadge active />);
    cy.get('[data-cy-root]').children().should('have.length.at.least', 1);
  });
});
