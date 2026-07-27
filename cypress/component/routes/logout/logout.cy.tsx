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

  it('shows "Sign out of <loginName>" when an active session exists (no switch link)', () => {
    const router = createMemoryRouter([{ id: 'logout', path: '/logout', element: <Logout /> }], {
      initialEntries: ['/logout'],
      hydrationData: {
        loaderData: { logout: { csrfToken: 'test-csrf', loginName: 'mia@acme.test' } },
      },
    });
    mount(withProviders(<RouterProvider router={router} />));
    cy.contains('Sign out of').should('be.visible');
    cy.contains('mia@acme.test').should('be.visible');
    // Scoped, not a blanket "no <a> on the page": BrandLogo always renders a home link.
    // What IdentityBadge's showLink=false must suppress is its OWN "Not you?" switch-account
    // link (which targets /login). This assertion catches if showLink={false} is accidentally removed.
    cy.contains(/not you\?/i).should('not.exist');
    cy.get('a[href="/login"], a[href^="/login?"]').should('not.exist');
  });

  it('falls back to the generic confirm copy when there is no active session', () => {
    const router = createMemoryRouter([{ id: 'logout', path: '/logout', element: <Logout /> }], {
      initialEntries: ['/logout'],
      hydrationData: { loaderData: { logout: { csrfToken: 'test-csrf', loginName: '' } } },
    });
    mount(withProviders(<RouterProvider router={router} />));
    cy.contains('Are you sure you want to sign out?').should('be.visible');
  });
});
