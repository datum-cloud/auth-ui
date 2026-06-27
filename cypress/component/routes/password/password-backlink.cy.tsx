// cypress/component/routes/password/password-backlink.cy.tsx
//
// MOUNT: password/new and password/change BackLink presence and inline action error.
// Migrated from: app/routes/password/__tests__/password-backlink.test.tsx
//
// Note: exact error message text depends on Lingui translations (no vi.mock in Cypress).
// We assert role="alert" existence instead of text content.
import PasswordChange from '@/routes/password/change';
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

describe('password BackLink', () => {
  it('password/new renders a Back link to /login/password (preserving the query)', () => {
    mountAt(PasswordNew, 'password-new', '/password/new', {
      csrfToken: 't',
      code: 'c',
      userId: 'u',
      organization: undefined,
      requestId: undefined,
    });
    cy.contains(/Choose a new password/i).should('exist');
    cy.get('a[href*="/login/password"]')
      .should('exist')
      .and(($a) => {
        expect($a.attr('href')).to.include('loginName=a%40b.test');
      });
  });

  it('password/change renders a Back link to /login/password', () => {
    mountAt(PasswordChange, 'password-change', '/password/change', {
      csrfToken: 't',
      sessionId: 's',
      loginName: 'a@b.test',
      requestId: undefined,
    });
    cy.contains(/Change your password/i).should('exist');
    cy.get('a[href*="/login/password"]').should('exist');
  });
});

describe('password inline action error (no toast)', () => {
  it('password/new renders a role="alert" banner when actionData.error is set', () => {
    mountAt(
      PasswordNew,
      'password-new',
      '/password/new',
      { csrfToken: 't', code: 'c', userId: 'u', organization: undefined, requestId: undefined },
      { error: 'INVALID_INPUT' }
    );
    cy.get('[role="alert"]').should('exist');
  });

  it('password/new renders NO alert banner when there is no action error', () => {
    mountAt(PasswordNew, 'password-new', '/password/new', {
      csrfToken: 't',
      code: 'c',
      userId: 'u',
      organization: undefined,
      requestId: undefined,
    });
    cy.contains(/Choose a new password/i).should('exist');
    cy.get('[role="alert"]').should('not.exist');
  });

  it('password/change renders a role="alert" banner when actionData.error is set', () => {
    mountAt(
      PasswordChange,
      'password-change',
      '/password/change',
      { csrfToken: 't', sessionId: 's', loginName: 'a@b.test', requestId: undefined },
      { error: 'PASSWORD_TOO_SHORT' }
    );
    cy.get('[role="alert"]').should('exist');
  });

  it('password/change renders NO alert banner when there is no action error', () => {
    mountAt(PasswordChange, 'password-change', '/password/change', {
      csrfToken: 't',
      sessionId: 's',
      loginName: 'a@b.test',
      requestId: undefined,
    });
    cy.contains(/Change your password/i).should('exist');
    cy.get('[role="alert"]').should('not.exist');
  });
});
