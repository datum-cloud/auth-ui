// cypress/component/routes/login/login-render.cy.tsx
//
// Render adoption port of app/routes/login/__tests__/login-render.test.tsx.
//
// Pins the inline action-error alert: errors surface INLINE as role="alert" (toast → inline).
// Uses createMemoryRouter + hydrationData — no vi.mock needed; the real hooks work under Cypress.
import VerifyAuthenticator from '@/routes/login/verify/authenticator';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const LOGIN_CONTEXT = {
  loginName: 'alice@acme.test',
  requestId: 'rq-123',
  organization: 'acme',
};
const OTP_LOADER_DATA = { csrfToken: 'csrf-token-xyz' };

function withI18n(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

function mountChildRoute(
  path: string,
  childId: string,
  Component: React.ComponentType,
  loaderData: unknown,
  actionData?: unknown
) {
  const router = createMemoryRouter(
    [
      {
        id: 'login',
        path: '/login',
        loader: () => LOGIN_CONTEXT,
        children: [
          {
            id: childId,
            path: path.replace('/login/', ''),
            element: <Component />,
          },
        ],
      },
    ],
    {
      initialEntries: [path],
      hydrationData: {
        loaderData: { login: LOGIN_CONTEXT, [childId]: loaderData },
        ...(actionData !== undefined ? { actionData: { [childId]: actionData } } : {}),
      },
    }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

// ── VerifyAuthenticator ──────────────────────────────────────────────────────

describe('login/verify/authenticator — render adoption', () => {
  it('threads the resolved action-error message INLINE as role="alert" (toast → inline)', () => {
    mountChildRoute('/login/verify/authenticator', 'va', VerifyAuthenticator, OTP_LOADER_DATA, {
      error: 'INVALID_CREDENTIALS',
    });
    cy.findByRole('alert').should('contain', 'Incorrect credentials. Please try again.');
  });
});
