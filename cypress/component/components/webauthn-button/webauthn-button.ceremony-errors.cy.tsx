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
    // A single test may drive more than one ceremony failure (one mount per DOMException).
    // Cypress only auto-restores stubs BETWEEN tests, so re-stubbing the same method inside
    // one test throws "Attempted to wrap create which is already wrapped" — undo the previous
    // row's stub first. No-op on the first row, where nothing is wrapped yet.
    const creds = win.navigator.credentials as unknown as Record<string, { restore?: () => void }>;
    creds[method]?.restore?.();
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

  // Each row is one full ceremony: remount, reject create() with the named DOMException,
  // assert that reason's enroll copy. mountRejecting restores the previous row's stub and
  // the remount clears the previous row's copy, so rows are independent; cy.log names the
  // row in the command log right before its assertions.
  it('classifies each remaining DOMException to its enroll copy', () => {
    const rows: ReadonlyArray<{ label: string; domName: string; copy: RegExp }> = [
      {
        label: 'InvalidStateError → already-registered',
        domName: 'InvalidStateError',
        copy: /already have a passkey for this account/i,
      },
      {
        label: "NotSupportedError → device can't create a passkey",
        domName: 'NotSupportedError',
        copy: /can't create a passkey/i,
      },
      {
        label: 'SecurityError → security-reasons setup copy',
        domName: 'SecurityError',
        copy: /passkey setup couldn't be completed for security reasons/i,
      },
      {
        label: 'unmapped DOMException (NetworkError) → generic enroll copy',
        domName: 'NetworkError',
        copy: /couldn't set up your passkey/i,
      },
    ];
    for (const row of rows) {
      cy.log(row.label);
      mountRejecting('attestation', 'create', row.domName);
      cy.findByText(row.copy).should('exist');
    }
  });
});

describe('WebAuthnButton sign-in (assertion) failure copy', () => {
  it('NotAllowedError → cancelled / no-passkey sign-in guidance', () => {
    mountRejecting('assertion', 'get', 'NotAllowedError');
    cy.findByText(/passkey sign-in was cancelled/i).should('exist');
    cy.findByText(/set up your passkey/i).should('exist');
  });

  // Same table pattern as the enroll describe: one full ceremony per labeled row.
  it('classifies NotSupportedError and SecurityError to their sign-in copy', () => {
    const rows: ReadonlyArray<{ label: string; domName: string; copy: RegExp }> = [
      {
        label: "NotSupportedError → device can't use a passkey to sign in",
        domName: 'NotSupportedError',
        copy: /can't use a passkey to sign in/i,
      },
      {
        label: 'SecurityError → security-reasons sign-in copy',
        domName: 'SecurityError',
        copy: /passkey sign-in couldn't be completed for security reasons/i,
      },
    ];
    for (const row of rows) {
      cy.log(row.label);
      mountRejecting('assertion', 'get', row.domName);
      cy.findByText(row.copy).should('exist');
    }
  });

  // already-registered (InvalidStateError) does not apply to a sign-in ceremony; it falls
  // back to the generic verification copy rather than showing enroll-only wording — the
  // same copy an unmapped DOMException (NetworkError) produces.
  it('unmapped DOMException and InvalidStateError both → generic sign-in copy (already-registered N/A on sign-in)', () => {
    mountRejecting('assertion', 'get', 'NetworkError');
    cy.findByText(/verification failed/i).should('exist');

    mountRejecting('assertion', 'get', 'InvalidStateError');
    cy.findByText(/verification failed/i).should('exist');
    cy.findByText(/already have a passkey/i).should('not.exist');
  });
});
