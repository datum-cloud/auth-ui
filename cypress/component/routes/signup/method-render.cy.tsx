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

// Signup is passkey-only: showEmailLink/showPassword are still computed by resolveSignupView
// (the resolver is shared with /signup and unchanged) but this screen no longer reads them.
// Left TRUE here deliberately — a regression that re-renders either retired button would show up
// as an extra control on a view that permits them.
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
// all): the passkey-intent form must submit whatever token is in sessionStorage at the moment its
// own submit button is clicked — proving the ref/onClick wiring (not just index/password) closes
// the race here too. Asserted on the REAL submitted FormData (see mountMethod's action) rather
// than post-navigation DOM.
describe('signup/method — MaxMind deviceTrackingToken submit-time sync', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('submits the freshest sessionStorage token from the passkey-intent form even though the periodic sync never ticked', () => {
    const submitted: FormData[] = [];
    mountMethod((form) => submitted.push(form));
    cy.contains('john.doe@example.com', { timeout: 6000 });
    cy.window().then((win) => {
      win.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, 'tok-fast-signup-method');
    });
    cy.contains('button', 'Use a passkey')
      .closest('form')
      .find('input[name="deviceTrackingToken"]')
      .should('have.value', '');
    cy.contains('button', 'Use a passkey').click();
    cy.wrap(submitted, { timeout: 6000 }).should('have.length', 1);
    cy.then(() => {
      expect(submitted[0].get('intent')).to.equal('passkey');
      expect(submitted[0].get('deviceTrackingToken')).to.equal('tok-fast-signup-method');
    });
  });
});

// Passkey-only signup. The retired controls are asserted ABSENT under a view that would still
// permit them, so re-adding either button (or restoring the old view gates) fails here.
describe('signup/method — passkey is the only offered credential', () => {
  it('renders exactly one method form, the passkey one', () => {
    mountMethod();
    cy.contains('john.doe@example.com', { timeout: 6000 });
    cy.get('form').should('have.length', 1);
    cy.get('input[name="intent"]').should('have.length', 1).and('have.value', 'passkey');
    cy.contains('button', 'Use a passkey').should('be.visible');
  });

  it('offers neither the email-link nor the password button', () => {
    mountMethod();
    cy.contains('john.doe@example.com', { timeout: 6000 });
    cy.contains('button', 'Email me a sign-in link').should('not.exist');
    cy.contains('button', 'Set a password').should('not.exist');
  });
});

// Policy (or absent mail delivery) can still leave passkey signup unavailable. The screen must
// say so rather than render an empty card — regression guard for the else-branch.
describe('signup/method — no usable method', () => {
  it('explains that signup is unavailable when passkey is not offered', () => {
    const view = { showEmailLink: true, showPasskey: false, showPassword: true };
    const loaderData = { ...LOADER_DATA, view };
    const router = createMemoryRouter(
      [
        {
          id: 'signup-method',
          path: '/signup/method',
          element: <SignupMethod />,
          loader: () => loaderData,
        },
      ],
      {
        initialEntries: ['/signup/method'],
        hydrationData: { loaderData: { 'signup-method': loaderData } },
      }
    );
    mount(withProviders(<RouterProvider router={router} />));
    cy.contains("Signing up isn't available right now", { timeout: 6000 }).should('be.visible');
    cy.get('form').should('not.exist');
  });
});
