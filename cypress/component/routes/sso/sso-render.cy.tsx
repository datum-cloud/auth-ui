// cypress/component/routes/sso/sso-render.cy.tsx
//
// MOUNT: SSO ceremony/management/error render sweep.
// Merged from:
//   app/routes/sso/__tests__/sso-render.test.tsx
//   app/routes/sso/provider/__tests__/error.test.tsx
//
// Pins: AuthFormFields hidden-input cluster on SsoLdap, csrf inputs on SsoIndex management
// forms, byte-frozen /login URL on SsoError "Back to sign in" link, and the
// ldap-link-unsupported specific message (not generic fallback).
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

  it('renders inside the AuthCeremony layout with username + password fields', () => {
    mountRoute(SsoLdap, 'sso-ldap', '/sso/ldap', '/sso/ldap', loaderData);
    cy.contains('Sign in with LDAP').should('exist');
    cy.get('input[name="username"], label')
      .contains(/Username/i)
      .should('exist');
    cy.get('input[type="password"], label')
      .contains(/Password/i)
      .should('exist');
  });
});

// ── sso/index ────────────────────────────────────────────────────────────────

describe('SsoIndex — AuthFormFields csrf adoption', () => {
  const loaderData = {
    csrfToken: 'csrf-mgmt',
    userId: 'u1',
    loginName: 'you@acme.test',
    linked: [{ idpId: 'g', idpUserId: 'gx', idpUserName: 'Google You' }],
    unlinked: [{ id: 'gh', name: 'GitHub' }],
    allowUnlink: true,
  };

  it('every management form carries a byte-frozen csrf hidden input (name="csrf")', () => {
    mountRoute(SsoIndex, 'sso-index', '/sso', '/sso', loaderData);
    cy.contains('Linked accounts').should('exist');
    cy.get('input[name="csrf"]').each(($el) => {
      expect($el.val()).to.equal('csrf-mgmt');
    });
    cy.get('input[name="csrf"]').should('have.length.gte', 3);
  });

  it('renders loginName as a plain paragraph (not an IdentityBadge)', () => {
    mountRoute(SsoIndex, 'sso-index', '/sso', '/sso', loaderData);
    cy.contains('Linked accounts').should('exist');
    cy.contains('you@acme.test').should('exist');
    cy.contains(/Not you\?/i).should('not.exist');
  });

  it('keeps the native sign-out form posting to the byte-frozen /id/logout?index action', () => {
    mountRoute(SsoIndex, 'sso-index', '/sso', '/sso', loaderData);
    cy.contains('Linked accounts').should('exist');
    cy.get('form[action="/id/logout?index"]').should('exist');
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

describe('SsoError ldap-link-unsupported — specific message (not generic fallback)', () => {
  it('renders a specific message for ldap-link-unsupported, not the generic fallback', () => {
    mountRoute(
      SsoError,
      'sso-ldap-error',
      '/sso/:provider/error',
      '/sso/ldap/error?reason=ldap-link-unsupported'
    );
    cy.contains(/can't be linked|not supported|password/i).should('exist');
    cy.contains(/Something went wrong with/i).should('not.exist');
  });
});
