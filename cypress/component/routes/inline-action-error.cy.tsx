// cypress/component/routes/inline-action-error.cy.tsx
//
// MOUNT: inline action-error surface for accounts, password/reset, verify/index,
// device/index, and device/authorize — role="alert" banner, no toast.
// Migrated from: app/routes/__tests__/inline-action-error.test.tsx
//
// Note: exact error message text depends on Lingui translations. We assert role="alert"
// existence rather than text content (vi.mock of useAuthErrorMessage is unavailable in Cypress).
import AccountPicker from '@/routes/accounts';
import DeviceAuthorize from '@/routes/device/authorize';
import Device from '@/routes/device/index';
import PasswordReset from '@/routes/password/reset';
import Verify from '@/routes/verify/index';
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

  it('renders a role="alert" banner when actionData.error is set', () => {
    mountAt(AccountPicker, 'accounts', '/accounts', loaderData, { error: 'SESSION_EXPIRED' });
    cy.get('[role="alert"]').should('exist');
  });

  it('renders NO alert banner when there is no action error', () => {
    mountAt(AccountPicker, 'accounts', '/accounts', loaderData);
    cy.contains('Choose an account').should('exist');
    cy.get('[role="alert"]').should('not.exist');
  });

  it('shows the re-auth mismatch banner when reauthMismatch is set', () => {
    mountAt(AccountPicker, 'accounts', '/accounts', {
      ...loaderData,
      reauthMismatch: true,
    });
    cy.contains(/different account than the one you were re-authenticating/i).should('exist');
  });

  it('does not show the re-auth mismatch banner by default', () => {
    mountAt(AccountPicker, 'accounts', '/accounts', loaderData);
    cy.contains('Choose an account').should('exist');
    cy.contains(/different account than the one you were re-authenticating/i).should('not.exist');
  });
});

describe('password/reset — inline action error (no toast)', () => {
  const loaderData = { csrfToken: 't', organization: undefined, requestId: undefined };

  it('renders a role="alert" banner when actionData.error is set', () => {
    mountAt(PasswordReset, 'password-reset', '/password/reset', loaderData, {
      error: 'INVALID_INPUT',
    });
    cy.get('[role="alert"]').should('exist');
  });

  it('renders NO alert banner when there is no action error', () => {
    mountAt(PasswordReset, 'password-reset', '/password/reset', loaderData);
    cy.contains(/Reset your password/i).should('exist');
    cy.get('[role="alert"]').should('not.exist');
  });
});

describe('verify/index — inline action error (no toast)', () => {
  const loaderData = {
    csrfToken: 't',
    userId: 'u',
    invite: undefined,
    loginName: undefined,
    organization: undefined,
    requestId: undefined,
    code: '',
  };

  it('renders a role="alert" banner when actionData.error is set', () => {
    mountAt(Verify, 'verify', '/verify', loaderData, { error: 'INVALID_INPUT' });
    cy.get('[role="alert"]').should('exist');
  });

  it('renders NO alert banner when there is no action error', () => {
    mountAt(Verify, 'verify', '/verify', loaderData);
    cy.contains(/Verify your email/i).should('exist');
    cy.get('[role="alert"]').should('not.exist');
  });
});

describe('device/index — inline action error (no toast)', () => {
  const loaderData = { csrfToken: 't', userCode: '' };

  it('renders a role="alert" banner when actionData.error is set', () => {
    mountAt(Device, 'device', '/device', loaderData, { error: 'NOT_FOUND' });
    cy.get('[role="alert"]').should('exist');
  });

  it('renders NO alert banner when there is no action error', () => {
    mountAt(Device, 'device', '/device', loaderData);
    cy.contains(/Activate your device/i).should('exist');
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

  it('renders NO alert banner when there is no action error', () => {
    mountAt(DeviceAuthorize, 'device-authorize', '/device/authorize', consentLoaderData);
    cy.contains(/Authorize device/i).should('exist');
    cy.get('[role="alert"]').should('not.exist');
  });
});
