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
  it('resolves message + recovery for a recoverable code (inline-only surface, no toast)', () => {
    cy.mount(<RecoveryHarness actionData={{ error: 'SESSION_EXPIRED' }} />);
    cy.get('[data-testid="message"]').should('have.text', 'Your session has expired.');
    cy.get('[data-testid="recovery-to"]').should('have.text', '/login');
    cy.get('[data-testid="recovery-label"]').should('have.text', 'Sign in again');
  });

  it('resolves message but no recovery for a non-recoverable code', () => {
    cy.mount(<RecoveryHarness actionData={{ error: 'INVALID_CREDENTIALS' }} />);
    cy.get('[data-testid="message"]').should(
      'have.text',
      'Incorrect credentials. Please try again.'
    );
    cy.get('[data-testid="recovery-to"]').should('have.text', '__none__');
  });

  it('returns undefined message + recovery when actionData has no error', () => {
    cy.mount(<RecoveryHarness actionData={undefined} />);
    cy.get('[data-testid="message"]').should('have.text', '__undefined__');
    cy.get('[data-testid="recovery-to"]').should('have.text', '__none__');
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

  it('yields a bare /login recovery when no ctx is forwarded', () => {
    cy.mount(<RecoveryHarness actionData={{ error: 'SESSION_EXPIRED' }} />);
    cy.get('[data-testid="recovery-to"]').should('have.text', '/login');
  });
});
