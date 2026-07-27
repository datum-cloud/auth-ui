// cypress/component/routes/reauth/provider-error.cy.tsx
//
// /reauth/:provider/error — thin error screen, mirrors sso/provider/error.tsx exactly
// (a generic message naming the provider, a link back into the live ceremony).
import ReauthProviderError from '@/routes/reauth/provider/error';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

function mountError(initialEntry: string) {
  const router = createMemoryRouter(
    [{ id: 'reauth-idp-error', path: '/reauth/:provider/error', element: <ReauthProviderError /> }],
    { initialEntries: [initialEntry] }
  );
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return mount(
    <I18nProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nProvider>
  );
}

describe('/reauth/:provider/error', () => {
  it('names the provider and links back to /reauth preserving returnTo', () => {
    mountError('/reauth/idp-google/error?returnTo=%2Fpasskeys');
    cy.contains('idp-google').should('be.visible');
    cy.contains('a', 'Try again').should('have.attr', 'href', '/reauth?returnTo=%2Fpasskeys');
  });

  it('shows the access-denied copy instead of the generic provider-name fallback', () => {
    mountError('/reauth/idp-google/error?returnTo=%2Fpasskeys&reason=access-denied');
    cy.contains('That identity belongs to a different account.').should('be.visible');
    cy.contains('Something went wrong').should('not.exist');
  });
});
