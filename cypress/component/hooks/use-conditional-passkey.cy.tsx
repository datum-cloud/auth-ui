// cypress/component/hooks/use-conditional-passkey.cy.tsx
//
// The conditional ceremony driver in isolation: arming gates, the Cypress auto-resolve
// seam, one-shot abort, and the retry-once contract. Mounted inside a memory router with
// a stubbed /login/passkey (same convention as routes/login/method.cy.tsx): the stub
// loader hands out challenges, the stub action captures ceremony POSTs. A SUCCESSFUL
// verify is a redirect (which the fetcher follows); returned DATA means rejection.
import { useConditionalPasskey } from '@/hooks/use-conditional-passkey';
import { mount } from 'cypress/react';
import React from 'react';
import { createMemoryRouter, redirect, RouterProvider } from 'react-router';

const OPTIONS = { publicKey: { challenge: 'x' } };
type W = Window & {
  __conditionalPasskeyAutoResolve?: boolean;
  __webAuthnRealCeremony?: boolean;
};

function Harness({ enabled, options }: { enabled: boolean; options: unknown }) {
  const cond = useConditionalPasskey({
    enabled,
    loginName: 'mia@acme.test',
    csrfToken: 'tok-1',
    publicKeyCredentialRequestOptions: options,
  });
  return (
    <div>
      <div data-testid="phase">{cond.phase}</div>
      <button data-testid="abort" onClick={cond.abort}>
        abort
      </button>
    </div>
  );
}

function mountHarness({
  enabled = true,
  options = OPTIONS as unknown,
  actionResult = undefined as unknown, // undefined → redirect('/signed-in') (success)
} = {}) {
  const capturedPosts: Array<Record<string, unknown>> = [];
  const router = createMemoryRouter(
    [
      { path: '/login', element: <Harness enabled={enabled} options={options} /> },
      { path: '/signed-in', element: <div data-testid="signed-in" /> },
      {
        path: '/login/passkey',
        loader: async () => ({
          csrfToken: 'tok-2',
          loginName: 'mia@acme.test',
          requestId: undefined,
          organization: undefined,
          publicKeyCredentialRequestOptions: OPTIONS,
        }),
        action: async ({ request }: { request: Request }) => {
          capturedPosts.push(Object.fromEntries(await request.formData()));
          return actionResult ?? redirect('/signed-in');
        },
      },
    ],
    { initialEntries: ['/login'] }
  );
  mount(<RouterProvider router={router} />);
  return capturedPosts;
}

describe('useConditionalPasskey', () => {
  afterEach(() => {
    delete (window as W).__conditionalPasskeyAutoResolve;
    delete (window as W).__webAuthnRealCeremony;
  });

  it('auto-resolve seam: submits the pre-baked credential with the ceremony marker, follows the redirect', () => {
    (window as W).__conditionalPasskeyAutoResolve = true;
    const posts = mountHarness({});
    cy.get('[data-testid="signed-in"]').should('exist');
    cy.then(() => {
      expect(posts).to.have.length(1);
      expect(posts[0].loginName).to.equal('mia@acme.test');
      expect(posts[0].passkeyCeremony).to.equal('1');
      expect(posts[0].csrf).to.equal('tok-1');
      expect(String(posts[0].credential)).to.contain('"id"');
    });
  });

  it('without auto-resolve the ceremony parks in armed — no POST', () => {
    const posts = mountHarness({});
    cy.get('[data-testid="phase"]').should('have.text', 'armed');
    cy.then(() => expect(posts).to.have.length(0));
  });

  it('enabled=false stays fully inert', () => {
    (window as W).__conditionalPasskeyAutoResolve = true;
    const posts = mountHarness({ enabled: false });
    cy.get('[data-testid="phase"]').should('have.text', 'idle');
    cy.then(() => expect(posts).to.have.length(0));
  });

  it('null options stay fully inert', () => {
    (window as W).__conditionalPasskeyAutoResolve = true;
    const posts = mountHarness({ options: null });
    cy.get('[data-testid="phase"]').should('have.text', 'idle');
    cy.then(() => expect(posts).to.have.length(0));
  });

  it('abort() retires the ceremony permanently', () => {
    const posts = mountHarness({});
    cy.get('[data-testid="phase"]').should('have.text', 'armed');
    cy.get('[data-testid="abort"]').click();
    cy.get('[data-testid="phase"]').should('have.text', 'done');
    cy.then(() => expect(posts).to.have.length(0));
  });

  it('a rejected assertion re-fetches and re-arms exactly ONCE, then stops silently', () => {
    (window as W).__conditionalPasskeyAutoResolve = true;
    const posts = mountHarness({ actionResult: { error: 'INVALID_CREDENTIALS' } });
    cy.get('[data-testid="phase"]').should('have.text', 'done');
    cy.then(() => {
      expect(posts).to.have.length(2);
      expect(posts[1].csrf).to.equal('tok-2'); // retry uses the re-fetched challenge's token
    });
  });

  it('real path skips arming when conditional mediation is unavailable', () => {
    (window as W).__webAuthnRealCeremony = true; // force the REAL branch under Cypress
    const pkc = window.PublicKeyCredential as unknown as {
      isConditionalMediationAvailable?: () => Promise<boolean>;
    };
    const original = pkc.isConditionalMediationAvailable;
    pkc.isConditionalMediationAvailable = () => Promise.resolve(false);
    const posts = mountHarness({});
    cy.get('[data-testid="phase"]').should('have.text', 'idle');
    cy.then(() => {
      expect(posts).to.have.length(0);
      pkc.isConditionalMediationAvailable = original;
    });
  });
});
