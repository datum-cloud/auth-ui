// cypress/component/routes/signup/password-render.cy.tsx
//
// Render port of app/routes/signup/__tests__/password.render.test.tsx.
// Pins shared-primitive adoption: AuthCeremony layout div, shared AuthFormFields
// csrf input, ceremony-owned BackLink to /signup.
import { MAXMIND_TOKEN_STORAGE_KEY } from '@/modules/fraud/maxmind-tracker';
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

function mountPassword(
  onSubmitFormData?: (form: FormData) => void,
  data: typeof LOADER_DATA = LOADER_DATA
) {
  const router = createMemoryRouter(
    [
      {
        id: 'signup-password',
        path: '/signup/password',
        element: <SignupPassword />,
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
        loader: () => data,
      },
    ],
    {
      initialEntries: ['/signup/password'],
      hydrationData: { loaderData: { 'signup-password': data } },
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

  it('"Not you?" link threads the ceremony requestId + organization back to /signup (not a bare /signup)', () => {
    // Seed real ceremony params so the assertion actually exercises threading — with the bare
    // fixture (requestId/organization undefined) the href degrades to "/signup" no matter whether
    // threading works, is hardcoded, or is wired to the wrong fields, so it proves nothing.
    const withCeremony = { ...LOADER_DATA, requestId: 'oidc_V2_123', organization: 'org-1' };
    mountPassword(undefined, withCeremony);
    cy.contains(withCeremony.loginName, { timeout: 6000 }).should('exist');
    cy.findByRole('link', { name: /not you/i })
      .should('have.attr', 'href')
      .and('include', '/signup?')
      .and('include', 'requestId=oidc_V2_123')
      .and('include', 'organization=org-1');
  });
});

// RED→GREEN (fast-signup race fix): same submit-time sync as signup/index — the click-time read
// must win over the periodic mirror-sync interval, which may not have ticked yet. Asserted on
// the REAL submitted FormData (see mountPassword's action) rather than post-navigation DOM.
describe('signup/password — MaxMind deviceTrackingToken submit-time sync', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('submits the freshest sessionStorage token even though the periodic sync interval never ticked', () => {
    const submitted: FormData[] = [];
    mountPassword((form) => submitted.push(form));
    cy.get('input[name="password"]', { timeout: 6000 }).type('correct-horse-battery');
    cy.get('input[name="confirm"]').type('correct-horse-battery');
    // Seed the token AFTER mount, simulating device.js/the mirror landing after render but
    // before the periodic sync interval has had a chance to tick.
    cy.window().then((win) => {
      win.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, 'tok-fast-signup-pw');
    });
    cy.get('input[name="deviceTrackingToken"]').should('have.value', '');
    cy.contains('button', 'Create account').click();
    cy.wrap(submitted, { timeout: 6000 }).should('have.length', 1);
    cy.then(() => {
      expect(submitted[0].get('deviceTrackingToken')).to.equal('tok-fast-signup-pw');
    });
  });
});
