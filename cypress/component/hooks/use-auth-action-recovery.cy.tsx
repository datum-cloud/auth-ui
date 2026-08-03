// cypress/component/hooks/use-auth-action-recovery.cy.tsx
// COMPONENT port of app/hooks/__tests__/use-auth-action-recovery.test.tsx
//
// useAuthActionRecovery combines useAuthErrorMessage + useAuthErrorRecovery — resolves BOTH
// inline message AND recovery affordance from actionData.error. Fires NO toast (inline surface only).
// cy.mount wraps with Lingui (empty catalog → template literal = the string itself).
import { useAuthActionRecovery } from '@/hooks/use-auth-action-recovery';
import React from 'react';

function RecoveryHarness({
  actionData,
  ctx,
}: {
  actionData: unknown;
  ctx?: { requestId?: string; organization?: string };
}) {
  const { message, recovery } = useAuthActionRecovery(actionData, ctx);
  return (
    <div>
      <div data-testid="message">{message ?? '__undefined__'}</div>
      <div data-testid="recovery-to">{recovery?.to ?? '__none__'}</div>
      <div data-testid="recovery-label">{String(recovery?.label ?? '__none__')}</div>
    </div>
  );
}

describe('useAuthActionRecovery', () => {
  // Table: actionData varies (no ctx); every row asserts all three always-rendered
  // testids. The SESSION_EXPIRED row also carries the former standalone
  // "bare /login when no ctx is forwarded" test — identical mount, identical
  // recovery-to === '/login' assertion.
  const RESOLUTION_ROWS = [
    {
      label: 'recoverable SESSION_EXPIRED (no ctx → bare /login)',
      actionData: { error: 'SESSION_EXPIRED' },
      message: 'Your session has expired.',
      to: '/login',
      labelText: 'Sign in again',
    },
    {
      label: 'non-recoverable INVALID_CREDENTIALS (message only, no recovery)',
      actionData: { error: 'INVALID_CREDENTIALS' },
      message: 'Incorrect credentials. Please try again.',
      to: '__none__',
      labelText: '__none__',
    },
    {
      label: 'actionData without error (undefined message + recovery)',
      actionData: undefined,
      message: '__undefined__',
      to: '__none__',
      labelText: '__none__',
    },
  ] as const;

  it('resolves message + recovery from actionData.error (inline-only surface, no toast)', () => {
    RESOLUTION_ROWS.forEach(({ label, actionData, message, to, labelText }) => {
      cy.mount(<RecoveryHarness actionData={actionData} />);
      cy.get('[data-testid="message"]').should(($el) => {
        expect($el.text(), `${label} → message`).to.equal(message);
      });
      cy.get('[data-testid="recovery-to"]').should(($el) => {
        expect($el.text(), `${label} → recovery.to`).to.equal(to);
      });
      cy.get('[data-testid="recovery-label"]').should(($el) => {
        expect($el.text(), `${label} → recovery.label`).to.equal(labelText);
      });
    });
  });

  // OIDC ceremony preservation: the hook forwards the in-scope ceremony ctx
  // (requestId/organization) to useAuthErrorRecovery so the recovery link returns
  // the user to the relying party.
  it('forwards the ceremony ctx (requestId) to the recovery resolver', () => {
    cy.mount(
      <RecoveryHarness
        actionData={{ error: 'SESSION_EXPIRED' }}
        ctx={{ requestId: 'rq1', organization: 'acme' }}
      />
    );
    cy.get('[data-testid="recovery-to"]').should(
      'have.text',
      '/login?requestId=rq1&organization=acme'
    );
  });
});
