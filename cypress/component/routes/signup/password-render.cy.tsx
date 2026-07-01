// cypress/component/routes/signup/password-render.cy.tsx
//
// Render port of app/routes/signup/__tests__/password.render.test.tsx.
// Pins shared-primitive adoption: AuthCeremony layout div, shared AuthFormFields
// csrf input, ceremony-owned BackLink to /signup.
import SignupPassword from '@/routes/signup/password';
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

const LOADER_DATA = {
  csrfToken: 'csrf-token-pw',
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
  organization: undefined,
  requestId: undefined,
  deviceTrackingToken: '',
  maxmindAccountId: '',
};

function mountPassword() {
  const router = createMemoryRouter(
    [{ id: 'signup-password', path: '/signup/password', element: <SignupPassword /> }],
    {
      initialEntries: ['/signup/password'],
      hydrationData: { loaderData: { 'signup-password': LOADER_DATA } },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('signup/password — render adoption', () => {
  it('renders the ceremony-owned BackLink pointing to /signup', () => {
    mountPassword();
    cy.findByRole('link', { name: /back/i }, { timeout: 6000 }).should(
      'have.attr',
      'href',
      '/signup'
    );
  });
});
