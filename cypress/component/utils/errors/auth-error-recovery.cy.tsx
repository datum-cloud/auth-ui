// cypress/component/utils/errors/auth-error-recovery.cy.tsx
// COMPONENT port of app/utils/errors/__tests__/auth-error-recovery.test.tsx
//
// useAuthErrorRecovery maps recoverable auth codes to inline recovery affordances.
// cy.mount wraps with Lingui (empty catalog → template literal = string).
// Recoverable codes: SESSION_EXPIRED, NO_SUPPORTED_METHOD, PASSWORD_NOT_ALLOWED.
import { paths } from '@/routes/paths';
import { useAuthErrorRecovery } from '@/utils/errors/auth-error-recovery';
import React from 'react';

function RecoveryHarness({
  code,
  ctx,
}: {
  code?: string;
  ctx?: { requestId?: string; organization?: string };
}) {
  const getRecovery = useAuthErrorRecovery(ctx);
  const recovery = getRecovery(code);
  if (!recovery) return <div data-testid="result">undefined</div>;
  return (
    <div>
      <div data-testid="to">{recovery.to}</div>
      <div data-testid="label">{String(recovery.label)}</div>
    </div>
  );
}

describe('useAuthErrorRecovery', () => {
  it('maps recoverable codes to their labelled recovery ("Sign in again" for SESSION_EXPIRED, "Start over" for NO_SUPPORTED_METHOD), pointing at paths.login.index()', () => {
    cy.mount(<RecoveryHarness code="SESSION_EXPIRED" />);
    cy.get('[data-testid="to"]').should('have.text', paths.login.index());
    cy.get('[data-testid="label"]').should('have.text', 'Sign in again');

    cy.mount(<RecoveryHarness code="NO_SUPPORTED_METHOD" />);
    cy.get('[data-testid="to"]').should('have.text', paths.login.index());
    cy.get('[data-testid="label"]').should('have.text', 'Start over');
  });

  it('returns undefined for a non-recoverable code and when there is no error code (banner only)', () => {
    cy.mount(<RecoveryHarness code="INVALID_CREDENTIALS" />);
    cy.get('[data-testid="result"]').should('have.text', 'undefined');

    cy.mount(<RecoveryHarness code={undefined} />);
    cy.get('[data-testid="result"]').should('have.text', 'undefined');
  });

  // OIDC ceremony preservation: recovery destination threads requestId + organization onto
  // /login so a mid-OIDC user returns to the relying party, not the default redirect.
  it('threads requestId + organization onto the recovery destination when ctx is provided', () => {
    cy.mount(
      <RecoveryHarness code="SESSION_EXPIRED" ctx={{ requestId: 'rq1', organization: 'acme' }} />
    );
    cy.get('[data-testid="to"]').should(
      'have.text',
      paths.login.index({ requestId: 'rq1', organization: 'acme' })
    );
    cy.get('[data-testid="to"]').should('have.text', '/login?requestId=rq1&organization=acme');
  });

  it('keeps the bare /login when ctx is absent or incomplete (non-OIDC flow)', () => {
    cy.mount(<RecoveryHarness code="SESSION_EXPIRED" />);
    cy.get('[data-testid="to"]').should('have.text', paths.login.index());
    cy.get('[data-testid="to"]').should('have.text', '/login');

    cy.mount(<RecoveryHarness code="SESSION_EXPIRED" ctx={{ organization: 'acme' }} />);
    cy.get('[data-testid="to"]').should('have.text', '/login');
  });
});
