// cypress/component/routes/sso/link-render.cy.tsx
//
// /sso/link renders only its signed-out state (every signed-in outcome is a loader redirect,
// see link-loader.cy.ts): a prompt to sign in first, one button per available IdP, and a Back
// link. Both ways out go to /login carrying returnTo, so the user comes back to the link flow.
import SsoLinkPage from '@/routes/sso/link';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const RETURN_TO = '/sso/link?provider=google&organization=acme corp';

function mountLink(providers: Array<{ id: string; name: string; type: string }>) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const router = createMemoryRouter(
    [{ id: 'sso-link', path: '/sso/link', element: <SsoLinkPage /> }],
    {
      initialEntries: ['/sso/link'],
      hydrationData: {
        loaderData: {
          'sso-link': { mode: 'sign-in-required', providers, returnTo: RETURN_TO },
        },
      },
    }
  );
  return mount(
    <I18nProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nProvider>
  );
}

describe('/sso/link — sign-in-required prompt', () => {
  it('lists each IdP as a GET form to /login that carries returnTo', () => {
    mountLink([
      { id: 'idp-g', name: 'Google', type: 'GOOGLE' },
      { id: 'idp-gh', name: 'GitHub', type: 'GITHUB' },
    ]);
    cy.findByRole('heading', { level: 1 }).should('contain.text', 'Link your account');
    cy.contains('You must be signed in to link an external account.').should('be.visible');
    for (const name of ['Google', 'GitHub']) {
      cy.findByRole('button', { name })
        .closest('form')
        .should('have.attr', 'method', 'get')
        .and('have.attr', 'action', '/login')
        .find('input[name="returnTo"]')
        .should('have.value', RETURN_TO);
    }
  });

  it('Back goes to /login with returnTo percent-encoded (a space stays %20, not +)', () => {
    mountLink([{ id: 'idp-g', name: 'Google', type: 'GOOGLE' }]);
    cy.findByRole('link', { name: 'Back' }).should(
      'have.attr',
      'href',
      `/login?returnTo=${encodeURIComponent(RETURN_TO)}`
    );
  });

  it('with no IdPs available it drops the provider list but keeps the way back', () => {
    mountLink([]);
    cy.contains('Sign in with').should('not.exist');
    cy.get('form').should('not.exist');
    cy.findByRole('link', { name: 'Back' }).should('have.attr', 'href').and('include', '/login');
  });
});
