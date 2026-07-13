// cypress/component/routes/signup/method-render.cy.tsx
//
// Render port of app/routes/signup/__tests__/method.render.test.tsx.
// Pins shared-primitive adoption: AuthCeremony layout div, shared AuthFormFields
// cluster (csrf + identity hidden inputs).
import { MAXMIND_TOKEN_STORAGE_KEY } from '@/modules/fraud/maxmind-tracker';
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
  maxmindAccountId: '',
  view: VIEW,
};

function mountMethod(onSubmitFormData?: (form: FormData) => void) {
  const router = createMemoryRouter(
    [
      {
        id: 'signup-method',
        path: '/signup/method',
        element: <SignupMethod />,
        // Captures the REAL submitted FormData so the MaxMind sync test below can assert on
        // what actually went out on the wire, not on post-navigation DOM state — React Router
        // treats a `<Form method="post">` submission as a real client-side navigation, which
        // re-renders (and can recreate) the route's DOM afterward. A matching `loader`
        // re-returning the same data keeps the post-submit revalidation from crashing (no
        // loader ⇒ useLoaderData() is undefined ⇒ the destructure in the component throws).
        action: async ({ request }) => {
          onSubmitFormData?.(await request.formData());
          return null;
        },
        loader: () => LOADER_DATA,
      },
    ],
    {
      initialEntries: ['/signup/method'],
      hydrationData: { loaderData: { 'signup-method': LOADER_DATA } },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('signup/method — render adoption', () => {
  it('emits shared csrf hidden input(s) from AuthFormFields on each method form', () => {
    mountMethod();
    cy.contains('john.doe@example.com', { timeout: 6000 });
    cy.get('input[name="csrf"][type="hidden"]').should('have.length.greaterThan', 0);
    cy.get('input[name="csrf"][type="hidden"]').each(($el) => {
      expect($el.val()).to.equal('csrf-token-xyz');
    });
  });
});

// RED→GREEN (fast-signup race fix + this screen previously had NO MaxMind tracker mounted at
// all): the password-intent form must submit whatever token is in sessionStorage at the moment
// its own submit button is clicked — proving the per-form ref/onClick wiring (not just
// index/password) closes the race here too. Asserted on the REAL submitted FormData (see
// mountMethod's action) rather than post-navigation DOM.
describe('signup/method — MaxMind deviceTrackingToken submit-time sync', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('submits the freshest sessionStorage token from the password-intent form even though the periodic sync never ticked', () => {
    const submitted: FormData[] = [];
    mountMethod((form) => submitted.push(form));
    cy.contains('john.doe@example.com', { timeout: 6000 });
    cy.window().then((win) => {
      win.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, 'tok-fast-signup-method');
    });
    // Three forms share the field name — scope to the password-intent form specifically.
    cy.contains('button', 'Set a password')
      .closest('form')
      .find('input[name="deviceTrackingToken"]')
      .should('have.value', '');
    cy.contains('button', 'Set a password').click();
    cy.wrap(submitted, { timeout: 6000 }).should('have.length', 1);
    cy.then(() => {
      expect(submitted[0].get('intent')).to.equal('password');
      expect(submitted[0].get('deviceTrackingToken')).to.equal('tok-fast-signup-method');
    });
  });
});
