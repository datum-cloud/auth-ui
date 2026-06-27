// cypress/component/shared/constants.cy.ts
// COMPONENT port of app/shared/__tests__/constants.test.ts
// Pure constant: CSRF_FORM_KEY = 'csrf'. No DOM / render needed.
import { CSRF_FORM_KEY as fromBarrel } from '@/shared';
import { CSRF_FORM_KEY } from '@/shared/constants';

describe('app/shared kernel', () => {
  it('exposes CSRF_FORM_KEY as the literal "csrf" (byte-frozen field name)', () => {
    expect(CSRF_FORM_KEY).to.equal('csrf');
  });

  it('re-exports CSRF_FORM_KEY through the barrel', () => {
    expect(fromBarrel).to.equal('csrf');
  });
});
