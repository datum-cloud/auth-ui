// cypress/component/routes/login/passkey-back-link.cy.tsx
//
// /login/passkey is once again the mainstream destination for a sole-passkey login
// (the inline ceremony on /login was removed), so a failed or wrong-account ceremony must
// have a way back. Mirrors /login/security-key, which has always had this target.
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

describe('/login/passkey — Back link', () => {
  it('renders Back with href to /login', () => {
    mountPasskey();
    cy.contains('a', 'Not you?').should('exist');
    cy.contains('a', 'Back').should('exist').and('have.attr', 'href').and('include', '/login');
  });

  it('preserves the ceremony query string on the Back target', () => {
    // mount at /login/passkey?loginName=mia%40acme.test
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
      { initialEntries: ['/login/passkey?loginName=mia%40acme.test'] }
    );
    mount(
      withI18n(<RouterProvider router={router} />)
    );
    cy.contains('a', 'Back').should('have.attr', 'href').and('include', 'loginName=mia%40acme.test');
  });
});
