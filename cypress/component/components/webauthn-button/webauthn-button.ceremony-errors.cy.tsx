// Browser-error-specific WebAuthn failure copy.
//
// navigator.credentials.create()/.get() THROW a DOMException on a real failure (no
// authenticator, cancelled, already-registered). WebAuthnButton must classify that
// DOMException and render a message specific to BOTH the reason AND the flow —
// enroll (mode="attestation") vs sign-in (mode="assertion", the default).
//
// Under Cypress the button normally takes the pre-baked-credential shortcut (see
// webauthn-button.cy.tsx). Here we opt INTO the real ceremony via the documented
// window.__webAuthnRealCeremony seam and stub navigator.credentials to reject with a
// specific DOMException, so the full path (ceremony → classifyWebAuthnError → copy)
// is exercised end-to-end.
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import React from 'react';

const PK_GET = { challenge: 'YQ', allowCredentials: [] };
const PK_CREATE = { challenge: 'YQ', user: { id: 'YQ' }, excludeCredentials: [] };

function ensureWebAuthnEnv(win: Window): void {
  const w = win as unknown as { PublicKeyCredential?: unknown };
  if (typeof w.PublicKeyCredential === 'undefined') {
    w.PublicKeyCredential = function () {} as unknown;
  }
  if (!win.navigator.credentials) {
    Object.defineProperty(win.navigator, 'credentials', {
      value: { create: () => Promise.resolve(null), get: () => Promise.resolve(null) },
      configurable: true,
    });
  }
}

/** Mount the button, force the real ceremony, and reject the given ceremony method with a DOMException. */
function mountRejecting(
  mode: 'assertion' | 'attestation',
  method: 'create' | 'get',
  domName: string
) {
  const formRef = React.createRef<HTMLFormElement | null>();
  const publicKey = mode === 'attestation' ? PK_CREATE : PK_GET;
  cy.mountRemixRoute(<WebAuthnButton publicKey={publicKey} formRef={formRef} mode={mode} />, {
    path: '/passkey',
    initialEntries: ['/passkey'],
  });
  cy.window().then((win) => {
    (win as unknown as { __webAuthnRealCeremony?: boolean }).__webAuthnRealCeremony = true;
    ensureWebAuthnEnv(win);
    cy.stub(win.navigator.credentials, method).rejects(new win.DOMException('boom', domName));
  });
  cy.findByRole('button').should('not.be.disabled').click();
}

describe('WebAuthnButton enroll (attestation) failure copy', () => {
  it('NotAllowedError → cancelled / no-support setup guidance', () => {
    mountRejecting('attestation', 'create', 'NotAllowedError');
    cy.findByText(/passkey setup was cancelled/i).should('exist');
    cy.findByText(/verification failed/i).should('not.exist');
  });

  it('InvalidStateError → already-registered', () => {
    mountRejecting('attestation', 'create', 'InvalidStateError');
    cy.findByText(/already have a passkey for this account/i).should('exist');
  });

  it("NotSupportedError → device can't create a passkey", () => {
    mountRejecting('attestation', 'create', 'NotSupportedError');
    cy.findByText(/can't create a passkey/i).should('exist');
  });

  it('SecurityError → security-reasons setup copy', () => {
    mountRejecting('attestation', 'create', 'SecurityError');
    cy.findByText(/passkey setup couldn't be completed for security reasons/i).should('exist');
  });

  it('unmapped DOMException → generic enroll copy', () => {
    mountRejecting('attestation', 'create', 'NetworkError');
    cy.findByText(/couldn't set up your passkey/i).should('exist');
  });
});

describe('WebAuthnButton sign-in (assertion) failure copy', () => {
  it('NotAllowedError → cancelled / no-passkey sign-in guidance', () => {
    mountRejecting('assertion', 'get', 'NotAllowedError');
    cy.findByText(/passkey sign-in was cancelled/i).should('exist');
    cy.findByText(/set up your passkey/i).should('exist');
  });

  it("NotSupportedError → device can't use a passkey to sign in", () => {
    mountRejecting('assertion', 'get', 'NotSupportedError');
    cy.findByText(/can't use a passkey to sign in/i).should('exist');
  });

  it('SecurityError → security-reasons sign-in copy', () => {
    mountRejecting('assertion', 'get', 'SecurityError');
    cy.findByText(/passkey sign-in couldn't be completed for security reasons/i).should('exist');
  });

  it('unmapped DOMException → generic sign-in copy', () => {
    mountRejecting('assertion', 'get', 'NetworkError');
    cy.findByText(/verification failed/i).should('exist');
  });

  // already-registered (InvalidStateError) does not apply to a sign-in ceremony; it falls
  // back to the generic verification copy rather than showing enroll-only wording.
  it('InvalidStateError → generic sign-in copy (already-registered N/A on sign-in)', () => {
    mountRejecting('assertion', 'get', 'InvalidStateError');
    cy.findByText(/verification failed/i).should('exist');
    cy.findByText(/already have a passkey/i).should('not.exist');
  });
});
