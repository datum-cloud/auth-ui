// cypress/component/routes/signup/method-render.cy.tsx
//
// Render port of app/routes/signup/__tests__/method.render.test.tsx.
// Pins shared-primitive adoption: AuthCeremony layout div, shared AuthFormFields
// cluster (csrf + identity hidden inputs).
import SignupMethod from '@/routes/signup/method';
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

const VIEW = { showEmailLink: true, showPasskey: true, showPassword: true };

const LOADER_DATA = {
  csrfToken: 'csrf-token-xyz',
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
  organization: undefined,
  requestId: undefined,
  deviceTrackingToken: undefined,
  view: VIEW,
};

function mountMethod() {
  const router = createMemoryRouter(
    [{ id: 'signup-method', path: '/signup/method', element: <SignupMethod /> }],
    {
      initialEntries: ['/signup/method'],
      hydrationData: { loaderData: { 'signup-method': LOADER_DATA } },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('signup/method — render adoption', () => {
  it('wraps the screen in the AuthCeremony tokenized layout div', () => {
    mountMethod();
    cy.contains('john.doe@example.com', { timeout: 6000 }).should('exist');
    cy.get('div.flex.flex-col.items-baseline.justify-center.gap-4').should('exist');
  });

  it('emits shared csrf hidden input(s) from AuthFormFields on each method form', () => {
    mountMethod();
    cy.contains('john.doe@example.com', { timeout: 6000 });
    cy.get('input[name="csrf"][type="hidden"]').should('have.length.greaterThan', 0);
    cy.get('input[name="csrf"][type="hidden"]').each(($el) => {
      expect($el.val()).to.equal('csrf-token-xyz');
    });
  });

  it('includes the loginName identity hidden input alongside csrf', () => {
    mountMethod();
    cy.contains('john.doe@example.com', { timeout: 6000 });
    cy.get('input[name="loginName"]').should('have.length.greaterThan', 0);
  });
});
