// cypress/component/routes/signed-in.cy.tsx
//
// /signed-in previously showed loginName as bare text with no switch-account
// affordance at all. Adds "Use a different account" (mirrors device/authorize.tsx).
import SignedIn from '@/routes/signed-in';
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

function mountSignedIn(loginName: string | null = 'mia@acme.test') {
  const router = createMemoryRouter(
    [
      {
        id: 'signed-in',
        path: '/signed-in',
        element: <SignedIn />,
        loader: async () => ({ loginName, userId: 'u1', csrfToken: 'tok-1' }),
      },
    ],
    { initialEntries: ['/signed-in'] }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('/signed-in — identity + switch-account link + sign-out', () => {
  it('shows "You are signed in as <loginName>" with a "Use a different account" link to /accounts', () => {
    mountSignedIn();
    cy.contains('You are signed in as').should('be.visible');
    cy.contains('mia@acme.test').should('be.visible');
    cy.findByRole('link', { name: /use a different account/i }).should(
      'have.attr',
      'href',
      '/accounts'
    );
  });

  it('the Sign out form posts to /id/logout?index', () => {
    mountSignedIn();
    cy.get('form[action="/id/logout?index"]').contains('button', 'Sign out').should('be.visible');
  });

  it('renders no identity line when loginName is absent', () => {
    mountSignedIn(null);
    cy.contains('You are signed in as').should('not.exist');
  });
});
