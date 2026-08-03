// cypress/component/routes/signup/method-back-link.cy.tsx
//
// signup/method.tsx used to double-mount BackLink (an explicit <BackLink/> plus
// AuthCeremony's own default-true auto-render) — both previously resolved to null
// (no /signup/method entry in previous-step.ts), so it was a latent duplicate-render
// bug. Now that the map has an entry (Task 2), exactly one Back control must render.
import SignupMethod from '@/routes/signup/method';
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

const LOADER_DATA = {
  csrfToken: 'tok-1',
  loginName: 'mia@acme.test',
  firstName: 'Mia',
  lastName: 'Doe',
  organization: undefined,
  requestId: undefined,
  deviceTrackingToken: undefined,
  maxmindAccountId: '',
  view: { showEmailLink: false, showPasskey: false, showPassword: true },
};

function mountSignupMethod() {
  const router = createMemoryRouter(
    [
      {
        id: 'signup-method',
        path: '/signup/method',
        element: <SignupMethod />,
        loader: async () => LOADER_DATA,
      },
    ],
    { initialEntries: ['/signup/method'] }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('/signup/method — exactly one Back control + identity, both targeting /signup', () => {
  it('renders a single Back link (no duplicate) and shows "Signing up as <loginName>. Not you?" linking back to /signup', () => {
    mountSignupMethod();
    cy.get('a')
      .filter(':contains("Back")')
      .should('have.length', 1)
      .and('have.attr', 'href')
      .and('match', /^\/signup(\?|$)/);

    // Identity + "Not you?" (mirrors signup/password) — same mountSignupMethod() fixture.
    cy.contains('Signing up as').should('be.visible');
    cy.contains(LOADER_DATA.loginName).should('be.visible');
    cy.findByRole('link', { name: /not you/i })
      .should('have.attr', 'href')
      .and('match', /^\/signup(\?|$)/);
  });
});
