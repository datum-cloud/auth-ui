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

const CASES: ReadonlyArray<{ label: string; actionData: unknown; expected: string }> = [
  {
    label: 'known error code',
    actionData: { error: 'INVALID_CREDENTIALS' },
    expected: 'Incorrect credentials. Please try again.',
  },
  {
    label: 'no error → undefined',
    actionData: undefined,
    expected: '__undefined__',
  },
];

describe('useAuthActionError', () => {
  it('resolves actionData.error to a message, undefined without an error (inline-only surface, no toast)', () => {
    for (const row of CASES) {
      cy.mount(<ActionErrorHarness actionData={row.actionData} />);
      cy.get('[data-testid="msg"]').should(($el) => {
        expect($el, row.label).to.have.text(row.expected);
      });
    }
  });
});
