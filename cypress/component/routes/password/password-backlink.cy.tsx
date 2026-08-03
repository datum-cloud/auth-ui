// cypress/component/routes/password/password-backlink.cy.tsx
//
// MOUNT: password/new BackLink presence and inline action error.
// Migrated from: app/routes/password/__tests__/password-backlink.test.tsx
//
// Note: exact error message text depends on Lingui translations (no vi.mock in Cypress).
// We assert role="alert" existence instead of text content. password/change shares the
// same ceremony-owned BackLink + inline-error primitives and is not duplicated here.
import PasswordNew from '@/routes/password/new';
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

function mountAt(
  Component: React.ComponentType,
  routeId: string,
  path: string,
  loaderData: unknown,
  actionData?: unknown
) {
  const router = createMemoryRouter([{ id: routeId, path, element: <Component /> }], {
    initialEntries: [`${path}?loginName=a%40b.test`],
    hydrationData: {
      loaderData: { [routeId]: loaderData },
      ...(actionData !== undefined ? { actionData: { [routeId]: actionData } } : {}),
    },
  });
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('password BackLink + inline action error (no toast)', () => {
  const loaderData = {
    csrfToken: 't',
    code: 'c',
    userId: 'u',
    organization: undefined,
    requestId: undefined,
  };

  it('renders a Back link preserving the query, and a role=alert banner on error', () => {
    mountAt(PasswordNew, 'password-new', '/password/new', loaderData);
    cy.contains(/Choose a new password/i).should('exist');
    cy.get('a[href*="/login/password"]')
      .should('exist')
      .and(($a) => {
        expect($a.attr('href')).to.include('loginName=a%40b.test');
      });

    mountAt(PasswordNew, 'password-new', '/password/new', loaderData, { error: 'INVALID_INPUT' });
    cy.get('[role="alert"]').should('exist');
  });
});
