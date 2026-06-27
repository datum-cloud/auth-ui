// cypress/component/routes/accounts-row.cy.tsx
//
// MOUNT: accounts row structure — switch form, remove form, no nested interactives, IdP badge.
// Migrated from: app/routes/__tests__/accounts-row.test.tsx
//
// Uses createMemoryRouter + hydrationData instead of vi.mock('react-router').
// Error message text depends on real Lingui (empty catalog) — inline-error assertions
// are covered by inline-action-error.cy.tsx which uses the same approach.
import AccountPicker from '@/routes/accounts';
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

function mountAccounts(loaderData: unknown, actionData?: unknown) {
  const router = createMemoryRouter(
    [{ id: 'accounts', path: '/accounts', element: <AccountPicker /> }],
    {
      initialEntries: ['/accounts'],
      hydrationData: {
        loaderData: { accounts: loaderData },
        ...(actionData !== undefined ? { actionData: { accounts: actionData } } : {}),
      },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

const account = (over: Record<string, unknown> = {}) => ({
  sessionId: 's1',
  loginName: 'alice@acme.test',
  organization: 'org-a',
  displayName: 'Alice',
  nextPath: '/signed-in',
  isActive: true,
  ...over,
});

describe('accounts row — switch form structure', () => {
  it('renders the switch form with CSRF + sessionId hidden inputs', () => {
    mountAccounts({ csrfToken: 'csrf-tok', accounts: [account()] });
    cy.get('form:has(input[name="intent"][value="switch"])').within(() => {
      cy.get('input[name="sessionId"]').should('have.value', 's1');
      cy.get('input[name="csrf"]').should('have.value', 'csrf-tok');
    });
  });

  it('renders a submit button inside the switch form that shows the displayName', () => {
    mountAccounts({ csrfToken: 'csrf-tok', accounts: [account()] });
    cy.get('form:has(input[name="intent"][value="switch"])')
      .find('button[type="submit"]')
      .should('contain.text', 'Alice');
  });

  it('keeps the remove control as a SEPARATE form (not nested in the switch button)', () => {
    mountAccounts({ csrfToken: 'csrf-tok', accounts: [account()] });
    cy.get('form:has(input[name="intent"][value="remove"])')
      .find('button[type="submit"]')
      .should('exist');
    // Switch form and remove form are different elements
    cy.get('form:has(input[value="switch"])').then(($switch) => {
      cy.get('form:has(input[value="remove"])').then(($remove) => {
        expect($switch[0]).not.to.equal($remove[0]);
      });
    });
  });

  it('has NO nested interactive elements (no button/anchor inside a button)', () => {
    mountAccounts({ csrfToken: 'csrf-tok', accounts: [account()] });
    cy.get('button').each(($btn) => {
      cy.wrap($btn).find('button').should('not.exist');
      cy.wrap($btn).find('a').should('not.exist');
    });
  });

  it('threads ceremony requestId into both switch and remove form hidden inputs', () => {
    mountAccounts({
      csrfToken: 'csrf-tok',
      accounts: [account()],
      requestId: 'oidc_V3-current',
    });
    cy.get('form:has(input[name="intent"][value="switch"])')
      .find('input[name="requestId"]')
      .should('have.value', 'oidc_V3-current');
    cy.get('form:has(input[name="intent"][value="remove"])')
      .find('input[name="requestId"]')
      .should('have.value', 'oidc_V3-current');
  });

  it('omits requestId hidden input when no ceremony is active', () => {
    mountAccounts({ csrfToken: 'csrf-tok', accounts: [account()], requestId: null });
    cy.get('input[name="requestId"]').should('not.exist');
  });

  it('threads ceremony requestId into the "Add another account" link', () => {
    mountAccounts({
      csrfToken: 'csrf-tok',
      accounts: [account()],
      requestId: 'oidc_V3-current',
    });
    cy.contains('a', 'Add another account').should(
      'have.attr',
      'href',
      '/login?requestId=oidc_V3-current'
    );
  });

  it('links "Add another account" to plain /login when no ceremony', () => {
    mountAccounts({ csrfToken: 'csrf-tok', accounts: [account()], requestId: null });
    cy.contains('a', 'Add another account').should('have.attr', 'href', '/login');
  });

  it('threads ceremony requestId into the empty-state "Add an account" link', () => {
    mountAccounts({ csrfToken: 'csrf-tok', accounts: [], requestId: 'oidc_V3-current' });
    cy.contains('a', 'Add an account').should(
      'have.attr',
      'href',
      '/login?requestId=oidc_V3-current'
    );
  });

  it('renders an IdP badge when idpName is present', () => {
    mountAccounts({ csrfToken: 't', accounts: [account({ idpName: 'Google' })] });
    cy.contains('Google').should('exist');
  });

  it('renders no IdP badge when idpName is absent', () => {
    mountAccounts({ csrfToken: 't', accounts: [account()] });
    cy.contains('Google').should('not.exist');
  });
});
