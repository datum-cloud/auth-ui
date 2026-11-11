// cypress/component/routes/login/passkey-recovery-link.cy.tsx
//
// The "Can't use your passkey?" link. It used to be decided by resolveLoginView and shown on
// /login's first paint; it now lives on /login/passkey and appears only once a ceremony has
// actually failed. Two facts gate it, and both are asserted here:
//   - the loader's `recoveryEnabled` (AUTH_ACCOUNT_RECOVERY_ENABLED), and
//   - an action error — before a failure the link is noise for the majority who sign in fine,
//     and it advertises a recovery door to anyone who merely loads the page.
import LoginPasskey from '@/routes/login/passkey';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const LINK_TEXT = "Can't use your passkey?";

function withI18n(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

interface MountOpts {
  recoveryEnabled: boolean;
  /** The action's answer to the posted assertion; omitted = the ceremony is never submitted. */
  actionError?: string;
  requestId?: string;
  organization?: string;
}

function mountPasskey({ recoveryEnabled, actionError, requestId, organization }: MountOpts) {
  const router = createMemoryRouter(
    [
      {
        id: 'passkey',
        path: '/login/passkey',
        element: <LoginPasskey />,
        loader: async () => ({
          csrfToken: 'tok-1',
          loginName: 'mia@acme.test',
          requestId,
          organization,
          publicKeyCredentialRequestOptions: { publicKey: { challenge: 'x' } },
          recoveryEnabled,
        }),
        action: async () => ({ error: actionError }),
      },
    ],
    { initialEntries: ['/login/passkey'] }
  );
  mount(withI18n(<RouterProvider router={router} />));
  // Post the ceremony form directly: the WebAuthn prompt itself cannot run in a component
  // spec, and what is under test is the screen's reaction to the action's answer.
  if (actionError) {
    cy.get('form').then(($form) => {
      void router.navigate('/login/passkey', {
        formMethod: 'post',
        formData: new FormData($form[0] as HTMLFormElement),
      });
    });
  }
}

describe('/login/passkey — recovery link', () => {
  it('is absent on first paint, even with recovery enabled', () => {
    mountPasskey({ recoveryEnabled: true });
    cy.contains('button', 'Sign in with your passkey').should('exist');
    cy.contains(LINK_TEXT).should('not.exist');
  });

  it('appears after a failed attempt and carries the ceremony context to /recover', () => {
    mountPasskey({
      recoveryEnabled: true,
      actionError: 'INVALID_CREDENTIALS',
      requestId: 'req-7',
      organization: 'org-1',
    });
    cy.contains('a', LINK_TEXT)
      .should('have.attr', 'href')
      .and('include', '/recover')
      .and('include', 'email=mia%40acme.test')
      .and('include', 'requestId=req-7')
      .and('include', 'organization=org-1');
  });

  it('stays absent after a failed attempt while the flag is off', () => {
    mountPasskey({ recoveryEnabled: false, actionError: 'INVALID_CREDENTIALS' });
    // The failure itself is still reported; only the recovery door is withheld.
    cy.get('[role="alert"]').should('exist');
    cy.contains(LINK_TEXT).should('not.exist');
  });
});
