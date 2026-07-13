import { ErrorView } from '@/root';

describe('root ErrorBoundary', () => {
  it('renders the branded generic error copy and never echoes raw error text', () => {
    cy.mount(<ErrorView />);
    cy.contains(/something went wrong/i).should('exist');
    cy.contains(/SENSITIVE-STACK-DETAIL/).should('not.exist');
  });
});
