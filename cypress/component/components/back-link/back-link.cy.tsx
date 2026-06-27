import { BackLink } from '@/components/back-link/back-link';

describe('BackLink', () => {
  it('links /login/password back to /login, preserving the query', () => {
    cy.mount(<BackLink />, {
      initialEntries: ['/login/password?loginName=a%40b.c&requestId=oidc_x'],
      path: '*',
    });
    cy.findByRole('link')
      .should('have.attr', 'href')
      .and('match', /^\/login\?/)
      .and('include', 'loginName=a%40b.c')
      .and('include', 'requestId=oidc_x');
  });

  it('renders nothing on a step with no predecessor', () => {
    cy.mount(<BackLink />, { initialEntries: ['/login'], path: '*' });
    cy.get('a').should('not.exist');
  });
});
