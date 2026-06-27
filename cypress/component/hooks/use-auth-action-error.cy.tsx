// cypress/component/hooks/use-auth-action-error.cy.tsx
// COMPONENT port of app/hooks/__tests__/use-auth-action-error.test.tsx
//
// useAuthActionError narrows actionData → error code → message string via the real
// useAuthErrorMessage (Lingui, empty catalog → template literal = the string itself).
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import React from 'react';

function ActionErrorHarness({ actionData }: { actionData: unknown }) {
  const msg = useAuthActionError(actionData);
  return <div data-testid="msg">{msg ?? '__undefined__'}</div>;
}

describe('useAuthActionError', () => {
  it('resolves the message from actionData.error (inline-only surface, no toast)', () => {
    cy.mount(<ActionErrorHarness actionData={{ error: 'INVALID_CREDENTIALS' }} />);
    cy.get('[data-testid="msg"]').should('have.text', 'Incorrect credentials. Please try again.');
  });

  it('returns undefined for actionData without an error', () => {
    cy.mount(<ActionErrorHarness actionData={undefined} />);
    cy.get('[data-testid="msg"]').should('have.text', '__undefined__');
  });
});
