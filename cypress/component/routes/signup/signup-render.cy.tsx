// cypress/component/routes/signup/signup-render.cy.tsx
//
// Render port of app/routes/signup/__tests__/signup-render.test.tsx.
// Pins shared-primitive adoption on the signup identifier screen:
//   - AuthFormFields csrf+identity cluster on both the IdP form and the email form
//   - Structural form shape (hidden inputs, field names)
//
// The useAuthActionError inline-alert test requires vi.mock and is not ported here;
// the inline error path is covered by the integration action tests in signup-track.cy.ts.
import { MAXMIND_TOKEN_STORAGE_KEY } from '@/modules/fraud/maxmind-tracker';
import Signup from '@/routes/signup/index';
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

const BASE_VIEW = {
  showIdpButtons: true,
  allowEmailEntry: true,
  showEmailLink: false,
  showPasskey: false,
  showPassword: true,
  signupUnavailable: false,
};

const IDPS = [{ id: 'idp-g', name: 'Google', type: 'GOOGLE' }];

function loaderData(overrides: Record<string, unknown> = {}) {
  return {
    csrfToken: 'csrf-token-xyz',
    branding: { logoUrl: '', themeMode: 'light' },
    view: BASE_VIEW,
    idps: IDPS,
    organization: 'acme',
    requestId: 'rq-123',
    maxmindAccountId: '',
    prefill: { email: '' },
    idp: undefined,
    ...overrides,
  };
}

function mountSignup(data: unknown, onSubmitFormData?: (form: FormData) => void) {
  const router = createMemoryRouter(
    [
      {
        id: 'signup',
        path: '/signup',
        element: <Signup />,
        // Captures the REAL submitted FormData so the MaxMind sync test below can assert on
        // what actually went out on the wire, not on post-navigation DOM state — React Router
        // treats a `<Form method="post">` submission as a real client-side navigation, which
        // re-renders (and can recreate) the route's DOM afterward, so asserting on the input's
        // value AFTER the click is asserting the wrong thing. A matching `loader` re-returning
        // the same data keeps the route's post-submit revalidation from crashing (no loader ⇒
        // useLoaderData() is undefined ⇒ the destructure in Signup() throws).
        action: async ({ request }) => {
          onSubmitFormData?.(await request.formData());
          return null;
        },
        loader: () => data,
      },
    ],
    {
      initialEntries: ['/signup'],
      hydrationData: { loaderData: { signup: data } },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('signup/index — render adoption', () => {
  it('emits csrf + requestId + organization hidden inputs on the IdP button form', () => {
    mountSignup(loaderData());
    cy.contains('Google', { timeout: 6000 }).should('exist');
    // The first form is the IdP form; it must carry csrf, requestId, organization.
    cy.get('form')
      .first()
      .within(() => {
        cy.get('input[type="hidden"][name="csrf"]').should('have.value', 'csrf-token-xyz');
        cy.get('input[type="hidden"][name="requestId"]').should('have.value', 'rq-123');
        cy.get('input[type="hidden"][name="organization"]').should('have.value', 'acme');
      });
  });

  it('shows IdP button and hides Email entry button when emailDeliveryEnabled=false (IdP-only signup)', () => {
    // view.allowEmailEntry=false when delivery is off — the Email button must not appear.
    mountSignup(
      loaderData({
        view: {
          ...BASE_VIEW,
          allowEmailEntry: false,
          showEmailLink: false,
        },
      })
    );
    cy.contains('Google', { timeout: 6000 }).should('exist');
    cy.contains('Email').should('not.exist');
  });

  it('shows unavailable message and no blank content when delivery off + no IdPs (signupUnavailable=true)', () => {
    // RED→GREEN: before the fix this rendered a blank content area (no IdP buttons,
    // no Email button, no message). signupUnavailable=true must surface the message.
    mountSignup(
      loaderData({
        view: {
          ...BASE_VIEW,
          showIdpButtons: false,
          allowEmailEntry: false,
          showEmailLink: false,
          signupUnavailable: true,
        },
        idps: [],
      })
    );
    cy.contains('Registration is currently unavailable', { timeout: 6000 }).should('exist');
    cy.contains('Email').should('not.exist');
    cy.contains('Google').should('not.exist');
  });
});

// RED→GREEN (fast-signup race fix): the deviceTrackingToken FIELD SUBMITTED ON THE WIRE must
// carry whatever token is in sessionStorage AT SUBMIT TIME, not just whatever the periodic
// 300ms sync interval last wrote. Seeding sessionStorage AFTER mount (simulating the token
// landing after the component rendered) and clicking Continue immediately proves the
// click-time read, not the interval, is what puts the token in the request — asserted on the
// REAL submitted FormData (not the post-navigation DOM, which React Router re-renders/can
// recreate once the submission completes, making it the wrong thing to assert on).
describe('signup/index — MaxMind deviceTrackingToken submit-time sync', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('submits the freshest sessionStorage token even though the periodic sync interval never ticked', () => {
    const submitted: FormData[] = [];
    mountSignup(loaderData(), (form) => submitted.push(form));
    cy.contains('button', 'Email', { timeout: 6000 }).click();
    cy.get('input[name="email"]').type('racer@example.com');
    // Seed the token AFTER the form is already showing — the periodic sync interval may not
    // have ticked yet (it runs every 300ms); the click-time read must still pick it up.
    cy.window().then((win) => {
      win.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, 'tok-fast-signup');
    });
    cy.get('input[name="deviceTrackingToken"]').should('have.value', '');
    cy.contains('button', 'Continue').click();
    // The action's FormData capture runs inside React Router's async submission handling —
    // poll (the array is the same mutable reference `mountSignup`'s action pushes into) rather
    // than asserting immediately after .click().
    cy.wrap(submitted, { timeout: 6000 }).should('have.length', 1);
    cy.then(() => {
      expect(submitted[0].get('deviceTrackingToken')).to.equal('tok-fast-signup');
    });
  });
});
