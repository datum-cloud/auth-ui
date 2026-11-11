// cypress/component/hooks/use-conditional-passkey-unmount.cy.tsx
//
// Unmount mid-ceremony on the REAL conditional-mediation branch (forced under Cypress via
// __webAuthnRealCeremony, with navigator.credentials.get stubbed to a promise the spec
// controls). Leaving the page must abort the parked request, and an assertion that the
// browser delivers anyway must not reach the verify action or the discover endpoint.
import { useConditionalPasskey } from '@/hooks/use-conditional-passkey';
import { mount } from 'cypress/react';
import React, { StrictMode } from 'react';
import { createMemoryRouter, redirect, RouterProvider } from 'react-router';

const OPTIONS = { publicKey: { challenge: 'eA' } };
type W = Window & { __webAuthnRealCeremony?: boolean };
type ConditionalPkc = { isConditionalMediationAvailable?: () => Promise<boolean> };

/** A credential shaped like the browser's, for a request that resolves after unmount. */
function lateCredential(): unknown {
  const buf = new Uint8Array([1]).buffer;
  return {
    id: 'late',
    rawId: buf,
    type: 'public-key',
    response: { authenticatorData: buf, clientDataJSON: buf, signature: buf, userHandle: null },
  };
}

function Harness({ mode }: { mode: 'hinted' | 'discovery' }) {
  const cond = useConditionalPasskey({
    enabled: true,
    mode,
    loginName: mode === 'hinted' ? 'mia@acme.test' : '',
    csrfToken: 'tok-1',
    publicKeyCredentialRequestOptions: OPTIONS,
  });
  return <div data-testid="phase">{cond.phase}</div>;
}

function mountHarness(mode: 'hinted' | 'discovery', { strict = false } = {}) {
  const capturedPosts: Array<Record<string, unknown>> = [];
  const router = createMemoryRouter(
    [
      { path: '/login', element: <Harness mode={mode} /> },
      { path: '/elsewhere', element: <div data-testid="elsewhere" /> },
      {
        path: '/login/passkey',
        action: async ({ request }: { request: Request }) => {
          capturedPosts.push(Object.fromEntries(await request.formData()));
          return redirect('/elsewhere');
        },
      },
    ],
    { initialEntries: ['/login'] }
  );
  const tree = <RouterProvider router={router} />;
  mount(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { capturedPosts, router };
}

describe('useConditionalPasskey: unmount mid-ceremony', () => {
  let originalAvailable: ConditionalPkc['isConditionalMediationAvailable'];
  let getOptions: CredentialRequestOptions[];
  let resolveGet: (cred: unknown) => void;

  beforeEach(() => {
    (window as W).__webAuthnRealCeremony = true; // force the REAL branch under Cypress
    const pkc = window.PublicKeyCredential as unknown as ConditionalPkc;
    originalAvailable = pkc.isConditionalMediationAvailable;
    pkc.isConditionalMediationAvailable = () => Promise.resolve(true);
    getOptions = [];
    cy.stub(navigator.credentials, 'get').callsFake((opts: CredentialRequestOptions) => {
      getOptions.push(opts);
      return new Promise((resolve) => {
        resolveGet = resolve;
      });
    });
    cy.stub(window, 'fetch')
      .as('fetch')
      .resolves(new Response('{}', { status: 400 }));
  });

  afterEach(() => {
    delete (window as W).__webAuthnRealCeremony;
    (window.PublicKeyCredential as unknown as ConditionalPkc).isConditionalMediationAvailable =
      originalAvailable;
  });

  for (const mode of ['hinted', 'discovery'] as const) {
    it(`${mode}: aborts the parked request and submits nothing after unmount`, () => {
      const { capturedPosts, router } = mountHarness(mode);
      cy.get('[data-testid="phase"]').should('have.text', 'armed');
      cy.then(() => {
        expect(getOptions).to.have.length(1);
        expect(getOptions[0].mediation).to.equal('conditional');
        expect(getOptions[0].signal?.aborted).to.equal(false);
        return router.navigate('/elsewhere');
      });
      cy.get('[data-testid="elsewhere"]').should('exist');
      cy.then(() => expect(getOptions[0].signal?.aborted).to.equal(true));
      // The browser hands over an assertion anyway (it raced the abort).
      cy.then(() => {
        resolveGet(lateCredential());
        return new Promise((resolve) => setTimeout(resolve));
      });
      cy.then(() => expect(capturedPosts).to.have.length(0));
      cy.get('@fetch').should('not.have.been.called');
    });
  }

  it('still arms exactly once under StrictMode (its simulated unmount is not a real one)', () => {
    mountHarness('hinted', { strict: true });
    cy.get('[data-testid="phase"]').should('have.text', 'armed');
    cy.then(() => {
      expect(getOptions).to.have.length(1);
      expect(getOptions[0].signal?.aborted).to.equal(false);
    });
  });
});
