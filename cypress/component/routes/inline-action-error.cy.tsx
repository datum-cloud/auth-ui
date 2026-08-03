// cypress/component/routes/inline-action-error.cy.tsx
//
// MOUNT: inline action-error surface — role="alert" banner, no toast.
// Migrated from: app/routes/__tests__/inline-action-error.test.tsx
//
// Note: exact error message text depends on Lingui translations. We assert role="alert"
// existence rather than text content (vi.mock of useAuthErrorMessage is unavailable in Cypress).
//
// This pattern is shared verbatim across accounts, password/reset, verify/index,
// device/index, and device/authorize. Second-pass trim: keeps the accounts route as the
// representative alert/no-alert pair, plus device/authorize for its distinct
// session-gated CTA branch. password/reset, verify/index, and device/index are not
// duplicated here — same primitive, already pinned once by accounts.
import AccountPicker from '@/routes/accounts';
import DeviceAuthorize from '@/routes/device/authorize';
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
    initialEntries: [path],
    hydrationData: {
      loaderData: { [routeId]: loaderData },
      ...(actionData !== undefined ? { actionData: { [routeId]: actionData } } : {}),
    },
  });
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('accounts — inline action error (no toast)', () => {
  const loaderData = { csrfToken: 't', accounts: [] };

  it('renders a role="alert" banner when actionData.error is set, and NO banner when there is no action error', () => {
    mountAt(AccountPicker, 'accounts', '/accounts', loaderData, { error: 'SESSION_EXPIRED' });
    cy.get('[role="alert"]').should('exist');

    mountAt(AccountPicker, 'accounts', '/accounts', loaderData);
    cy.contains('Choose an account').should('exist');
    cy.get('[role="alert"]').should('not.exist');
  });
});

describe('device/authorize — inline action error in consent form (no toast)', () => {
  const consentLoaderData = {
    csrfToken: 't',
    appName: 'Acme CLI',
    scope: ['read'],
    deviceAuthId: 'dev-1',
    requestId: 'rq-1',
    activeLoginName: 'user@example.test',
  };

  it('renders a role="alert" banner inside the consent form', () => {
    mountAt(DeviceAuthorize, 'device-authorize', '/device/authorize', consentLoaderData, {
      error: 'FAILED_PRECONDITION',
    });
    cy.get('[role="alert"]').should('exist');
    cy.contains('button', /Authorize/i).should('exist');
  });

  it('with no active session, shows a "Sign in to continue" CTA instead of Authorize', () => {
    mountAt(DeviceAuthorize, 'device-authorize', '/device/authorize', {
      ...consentLoaderData,
      activeLoginName: null,
    });
    cy.contains('a', /Sign in to continue/i).should('exist');
    cy.contains('button', /Authorize/i).should('not.exist');
    cy.contains('button', /Deny/i).should('exist');
  });
});
