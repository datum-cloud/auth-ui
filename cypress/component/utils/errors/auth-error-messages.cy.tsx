// cypress/component/utils/errors/auth-error-messages.cy.tsx
// COMPONENT port of app/utils/errors/__tests__/auth-error-messages.test.tsx
//
// SECURITY / REGRESSION: The device-code regression guard — 'not_found' / 'invalid_code'
// must map to device-specific messages, NOT to the generic "Something went wrong" fallback.
// cy.mount wraps with Lingui I18nProvider (empty catalog → template literal = message ID = string).
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
import React from 'react';

function MessageHarness({ code }: { code?: string }) {
  const getMessage = useAuthErrorMessage();
  const result = getMessage(code);
  return <div data-testid="msg">{result ?? '__undefined__'}</div>;
}

const GENERIC = 'Something went wrong. Please try again.';

describe('useAuthErrorMessage — device-code lookup codes (lowercase)', () => {
  // REGRESSION: device.service.ts emits lowercase codes ('not_found' / 'invalid_code');
  // without these cases they fell through to the generic fallback masking the real reason.
  // Also asserts the uppercase 'NOT_FOUND' generic-resource message stays distinct from
  // the lowercase device-specific ones.
  it("maps 'not_found'/'invalid_code' to device-specific messages (NOT the generic fallback), distinct from uppercase 'NOT_FOUND'", () => {
    cy.mount(<MessageHarness code="not_found" />);
    cy.get('[data-testid="msg"]').should(
      'have.text',
      'That device code was not found. Check the code on your device and try again.'
    );
    cy.get('[data-testid="msg"]').should('not.have.text', GENERIC);

    cy.mount(<MessageHarness code="invalid_code" />);
    cy.get('[data-testid="msg"]').should(
      'have.text',
      "That device code isn't valid. Check the code on your device and try again."
    );
    cy.get('[data-testid="msg"]').should('not.have.text', GENERIC);

    cy.mount(<MessageHarness code="NOT_FOUND" />);
    cy.get('[data-testid="msg"]').should(
      'have.text',
      "We couldn't find what you were looking for. Please try again."
    );
  });
});

describe('useAuthErrorMessage — baseline behavior', () => {
  it('returns undefined for no code (empty error surface)', () => {
    cy.mount(<MessageHarness code={undefined} />);
    cy.get('[data-testid="msg"]').should('have.text', '__undefined__');
  });

  it('resolves a known code to its specific message, and falls back to the generic message for an unknown code', () => {
    cy.mount(<MessageHarness code="INVALID_CREDENTIALS" />);
    cy.get('[data-testid="msg"]').should('have.text', 'Incorrect credentials. Please try again.');

    cy.mount(<MessageHarness code="SOME_UNKNOWN_CODE" />);
    cy.get('[data-testid="msg"]').should('have.text', GENERIC);
  });
});
