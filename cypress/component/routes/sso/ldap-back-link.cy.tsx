// cypress/component/routes/sso/ldap-back-link.cy.tsx
//
// /sso/ldap is an IdP-initiated entry point with no natural single previous step.
// Pins that Back is explicitly suppressed rather than silently rendering null.
import SsoLdap from '@/routes/sso/ldap';
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

function mountSsoLdap() {
  const router = createMemoryRouter(
    [
      {
        id: 'sso-ldap',
        path: '/sso/ldap',
        element: <SsoLdap />,
        loader: async () => ({
          csrfToken: 'tok-1',
          idpId: 'idp-1',
          requestId: undefined,
          organization: undefined,
        }),
      },
    ],
    { initialEntries: ['/sso/ldap'] }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('/sso/ldap — Back link explicitly suppressed', () => {
  it('renders the LDAP form with no Back control', () => {
    mountSsoLdap();
    cy.contains('Sign in with LDAP').should('be.visible');
    cy.contains('a', 'Back').should('not.exist');
  });
});
