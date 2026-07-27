// cypress/component/routes/device/authorize-identity.cy.tsx
//
// Pins the "Authorizing as X — Use a different account" identity row now rendered
// through the shared IdentityBadge component instead of bespoke flex markup.
import DeviceAuthorize from '@/routes/device/authorize';
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

const LOADER_DATA = {
  csrfToken: 'tok-1',
  appName: 'Acme CLI',
  scope: ['profile', 'email'],
  deviceAuthId: 'da-1',
  requestId: 'device_ABC123',
  activeLoginName: 'mia@acme.test',
};

function mountAuthorize() {
  const router = createMemoryRouter(
    [
      {
        id: 'device-authorize',
        path: '/device/authorize',
        element: <DeviceAuthorize />,
        loader: async () => LOADER_DATA,
      },
    ],
    { initialEntries: ['/device/authorize'] }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('/device/authorize — identity via shared IdentityBadge', () => {
  it('shows "Authorizing as <loginName>" with a "Use a different account" link to /accounts?user_code=...', () => {
    mountAuthorize();
    cy.contains('Authorizing as').should('be.visible');
    cy.contains(LOADER_DATA.activeLoginName).should('be.visible');
    cy.findByRole('link', { name: /use a different account/i })
      .should('have.attr', 'href')
      .and('include', '/accounts')
      .and('include', 'user_code=ABC123');
  });
});
