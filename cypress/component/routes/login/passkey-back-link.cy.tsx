// cypress/component/routes/login/passkey-back-link.cy.tsx
//
// /login/passkey is now a fallback/deep-link-only screen (2026-07-22 passkey rework) —
// no mainstream forward navigation lands here, so it has no meaningful "previous step".
// Pins that Back is explicitly suppressed rather than silently rendering null.
import LoginPasskey from '@/routes/login/passkey';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

function withI18n(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

function mountPasskey() {
  const router = createMemoryRouter(
    [
      {
        id: 'passkey',
        path: '/login/passkey',
        element: <LoginPasskey />,
        loader: async () => ({
          csrfToken: 'tok-1',
          loginName: 'mia@acme.test',
          requestId: undefined,
          organization: undefined,
          publicKeyCredentialRequestOptions: { publicKey: { challenge: 'x' } },
        }),
      },
    ],
    { initialEntries: ['/login/passkey'] }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('/login/passkey — Back link explicitly suppressed', () => {
  it('renders the identity header but no Back control', () => {
    mountPasskey();
    cy.contains('a', 'Not you?').should('exist');
    cy.contains('a', 'Back').should('not.exist');
  });
});
