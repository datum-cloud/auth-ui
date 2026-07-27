// cypress/component/routes/sso/sso-render.cy.tsx
//
// MOUNT: SSO ceremony/management/error render sweep — second-pass trim.
// Merged from:
//   app/routes/sso/__tests__/sso-render.test.tsx
//   app/routes/sso/provider/__tests__/error.test.tsx
//
// PROTECTED minimum kept: the aria-disabled sole-method-unlink accessibility assertion
// (WCAG 4.1.2 fix) and one representative unlink-dialog functional test, plus one
// representative render test each for SsoLdap and SsoError. The remaining csrf-adoption,
// allowUnlink-gate, and multi-identity permutations are cut here.
import SsoIndex from '@/routes/sso/index';
import SsoLdap from '@/routes/sso/ldap';
import SsoError from '@/routes/sso/provider/error';
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

function mountRoute(
  Component: React.ComponentType,
  routeId: string,
  path: string,
  initialEntry: string,
  loaderData?: unknown,
  actionData?: unknown
) {
  const router = createMemoryRouter([{ id: routeId, path, element: <Component /> }], {
    initialEntries: [initialEntry],
    hydrationData: {
      ...(loaderData !== undefined ? { loaderData: { [routeId]: loaderData } } : {}),
      ...(actionData !== undefined ? { actionData: { [routeId]: actionData } } : {}),
    },
  });
  return mount(withProviders(<RouterProvider router={router} />));
}

// ── sso/ldap ──────────────────────────────────────────────────────────────────

describe('SsoLdap — AuthCeremony + AuthFormFields adoption', () => {
  const loaderData = {
    csrfToken: 'csrf-ldap',
    idpId: 'idp-99',
    requestId: 'rq-7',
    organization: 'acme',
  };

  it('emits byte-frozen hidden inputs: csrf, idpId, requestId, organization', () => {
    mountRoute(SsoLdap, 'sso-ldap', '/sso/ldap', '/sso/ldap', loaderData);
    cy.contains('Sign in with LDAP').should('exist');
    cy.get('input[name="csrf"]').should('have.value', 'csrf-ldap');
    cy.get('input[name="idpId"]').should('have.value', 'idp-99');
    cy.get('input[name="requestId"]').should('have.value', 'rq-7');
    cy.get('input[name="organization"]').should('have.value', 'acme');
  });
});

// ── sso/index — unlink guard (confirm dialog + disabled sole-method row) ────────

describe('SsoIndex — unlink guard: dialog confirm + disabled sole sign-in method', () => {
  const loaderData = {
    csrfToken: 'csrf-mgmt',
    userId: 'u1',
    loginName: 'you@acme.test',
    linked: [
      // unlinkable:true → enabled trigger opening a confirm dialog
      {
        idpId: 'gh',
        idpUserId: 'gh-1',
        idpUserName: 'a-handle',
        name: 'GitHub',
        type: 'GITHUB',
        unlinkable: true,
      },
      // unlinkable:false → sole primary sign-in method → disabled + tooltip (no form)
      {
        idpId: 'g',
        idpUserId: 'g-1',
        idpUserName: 'you@gmail.com',
        name: 'Google',
        type: 'GOOGLE',
        unlinkable: false,
      },
    ],
    linkable: [],
    allowUnlink: true,
  };

  it('disables the Unlink control for the sole-method (unlinkable:false) row', () => {
    mountRoute(SsoIndex, 'sso-index', '/sso', '/sso', loaderData);
    cy.contains('Linked accounts').should('exist');
    // Inert via aria-disabled (kept focusable for a11y), not the native `disabled` attribute.
    cy.get('button[aria-disabled="true"]').contains('Unlink').should('exist');
  });

  it('keeps the unlink confirm form out of the DOM until the dialog is opened', () => {
    mountRoute(SsoIndex, 'sso-index', '/sso', '/sso', loaderData);
    cy.contains('Linked accounts').should('exist');
    // The unlink form lives inside the confirm Dialog (Radix unmounts content while closed).
    cy.get('input[name="intent"][value="unlink"]').should('not.exist');
    cy.get('button:not([aria-disabled="true"])').contains('Unlink').click();
    // Once opened, the confirm form carries the unlink intent + the target row's ids.
    cy.get('input[name="intent"][value="unlink"]').should('exist');
    cy.get('input[name="idpId"][value="gh"]').should('exist');
    cy.get('input[name="linkedUserId"][value="gh-1"]').should('exist');
    // …and exposes an enabled submit button to complete the unlink (the "Confirm submits" path).
    cy.get('button[type="submit"]').contains('Unlink').should('exist').and('not.be.disabled');
  });

  it('shows the active login name with a "Use a different account" switch link and a Sign out control', () => {
    mountRoute(SsoIndex, 'sso-index', '/sso', '/sso', loaderData);
    cy.contains('Logged in as').should('exist');
    cy.contains(loaderData.loginName).should('exist');
    cy.findByRole('link', { name: /use a different account/i }).should(
      'have.attr',
      'href',
      '/accounts'
    );
    cy.get('form[action="/id/logout?index"]').contains('button', 'Sign out').should('exist');
  });
});

// ── sso/provider/error ────────────────────────────────────────────────────────

describe('SsoError — typed paths.login.index() emits the byte-frozen login URL', () => {
  it('"Back to sign in" link resolves to the byte-frozen /login URL', () => {
    mountRoute(
      SsoError,
      'sso-error',
      '/sso/:provider/error',
      '/sso/google/error?reason=access-denied'
    );
    cy.contains('a', /Back to sign in/i).should('have.attr', 'href', '/login');
  });
});
