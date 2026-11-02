// cypress/component/routes/signed-in.cy.tsx
//
// /signed-in previously showed loginName as bare text with no switch-account
// affordance at all. Adds "Not you?" (mirrors device/authorize.tsx).
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
  it('renders the signed-in identity with a Not you? link and a Sign out form posting to ?index', () => {
    mountSignedIn();
    cy.contains('You are signed in as').should('be.visible');
    cy.contains('mia@acme.test').should('be.visible');
    cy.findByRole('link', { name: /not you\?/i }).should('have.attr', 'href', '/accounts');
    cy.get('form[action="/id/logout?index"]').contains('button', 'Sign out').should('be.visible');

    mountSignedIn(null);
    cy.contains('You are signed in as').should('not.exist');
  });

  it('identifies the user to Rybbit by user id only, never with the login name', () => {
    const calls: unknown[][] = [];
    window.rybbit = {
      event: () => {},
      identify: (...args: unknown[]) => {
        calls.push(args);
      },
      clearUserId: () => {},
      pageview: () => {},
    };
    mountSignedIn('mia@acme.test');
    cy.contains('You are signed in as').should('be.visible');
    cy.then(() => {
      expect(calls).to.deep.equal([['u1']]);
      expect(JSON.stringify(calls)).not.to.contain('mia@acme.test');
    });
  });
});
