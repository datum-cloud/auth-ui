// cypress/component/routes/password/change-identity.cy.tsx
//
// password/change.tsx previously showed a bare inert loginName paragraph. Upgrades it
// to the shared IdentityBadge styling with showLink=false (mid-password-change is not
// a good place to offer an account-switch/abandon affordance).
import PasswordChange from '@/routes/password/change';
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

function mountPasswordChange() {
  const router = createMemoryRouter(
    [
      {
        id: 'password-change',
        path: '/password/change',
        element: <PasswordChange />,
        loader: async () => ({
          csrfToken: 'tok-1',
          sessionId: 's1',
          loginName: 'mia@acme.test',
          requestId: undefined,
          // Real shape is `PasswordComplexity` (app/modules/auth/types.ts): minLength +
          // requires{Uppercase,Lowercase,Number,Symbol} — confirmed against
          // app/resources/password/password.schema.ts and password-complexity.ts.
          passwordComplexity: {
            minLength: 8,
            requiresUppercase: false,
            requiresLowercase: false,
            requiresNumber: false,
            requiresSymbol: false,
          },
        }),
      },
    ],
    { initialEntries: ['/password/change'] }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('/password/change — identity via IdentityBadge, no switch link', () => {
  it('shows "Signing in as <loginName>" with no switch-account link', () => {
    mountPasswordChange();
    cy.contains('Signing in as').should('be.visible');
    cy.contains('mia@acme.test').should('be.visible');
    // Scoped, not a blanket "no <a> on the page": /password/change always renders an
    // unrelated BackLink anchor to /login/password (previous-step.ts) plus a logo link —
    // both pre-exist this change. What IdentityBadge's showLink=false must suppress is
    // its OWN "Not you?" switch-account link (which targets /login, not /login/password).
    cy.contains(/not you\?/i).should('not.exist');
    cy.get('a[href="/login"], a[href^="/login?"]').should('not.exist');
  });
});
