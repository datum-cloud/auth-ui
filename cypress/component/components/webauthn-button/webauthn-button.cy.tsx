import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import React from 'react';

// WebAuthnButton calls useNavigation() + useSubmit() which require a DATA router.
// cy.mountRemixRoute uses createMemoryRouter (data router) — the correct wrapper.
//
// In Cypress, window.Cypress is defined, so the component takes the CYPRESS_CREDENTIAL
// shortcut (skips navigator.credentials). By NOT wrapping in a <form>, formRef.current
// remains null, which triggers setError('webauthn-failed') — the same error path that
// the Vitest test exercised via publicKey=null + mocked isWebAuthnSupported=true.
function mountBtn(mode: 'assertion' | 'attestation') {
  const formRef = React.createRef<HTMLFormElement | null>();
  cy.mountRemixRoute(<WebAuthnButton publicKey={null} formRef={formRef} mode={mode} />, {
    path: '/login',
    initialEntries: ['/login'],
  });
}

describe('WebAuthnButton failure copy', () => {
  it('attestation failure shows enrollment wording (not verification wording); assertion failure shows verification wording', () => {
    mountBtn('attestation');
    // Wait for the hydration gate (disabled → enabled) then click.
    cy.findByRole('button').should('not.be.disabled').click();
    // Enrollment wording ("set up") must appear; assertion wording must not.
    cy.findByText(/set up/i).should('exist');
    cy.findByText(/verification failed/i).should('not.exist');

    mountBtn('assertion');
    cy.findByRole('button').should('not.be.disabled').click();
    cy.findByText(/verification failed/i).should('exist');
  });
});
