// cypress/component/routes/logout/logout.cy.tsx
//
// MOUNT: logout confirm form — pins that the native <form> targets the index action via
// ?index so React Router routes the POST to logout/index (not the action-less layout).
// Migrated from: app/routes/logout/__tests__/logout.test.tsx
import Logout from '@/routes/logout/index';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

function withProviders(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

function mountLogout() {
  const router = createMemoryRouter([{ id: 'logout', path: '/logout', element: <Logout /> }], {
    initialEntries: ['/logout'],
    hydrationData: { loaderData: { logout: { csrfToken: 'test-csrf' } } },
  });
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('Logout confirm form — index-route POST disambiguation', () => {
  it('targets the index action via ?index (not the action-less layout)', () => {
    mountLogout();
    cy.contains('button', /sign out/i).should('exist');
    cy.get('form').should('have.attr', 'method', 'post');
    // Native <form> posts to its action verbatim. Without ?index, RR routes POST to the
    // action-less logout/layout (→ 405); ?index targets routes/logout/index which owns the action.
    cy.get('form').invoke('attr', 'action').should('include', '?index');
  });
});
