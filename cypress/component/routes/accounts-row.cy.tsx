// cypress/component/routes/accounts-row.cy.tsx
//
// MOUNT: accounts row structure — switch form, remove form, IdP badge.
// Migrated from: app/routes/__tests__/accounts-row.test.tsx
//
// Uses createMemoryRouter + hydrationData instead of vi.mock('react-router').
// Error message text depends on real Lingui (empty catalog) — inline-error assertions
// are covered by inline-action-error.cy.tsx which uses the same approach. Second-pass
// trim: keeps the CSRF-bearing switch form, the separate-remove-form safety property,
// and the IdP badge branch; requestId-threading and plain-login-link permutations cut.
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
  it('renders the switch form with CSRF + sessionId hidden inputs, and keeps remove as a SEPARATE form', () => {
    mountAccounts({ csrfToken: 'csrf-tok', accounts: [account()] });
    cy.get('form:has(input[name="intent"][value="switch"])').within(() => {
      cy.get('input[name="sessionId"]').should('have.value', 's1');
      cy.get('input[name="csrf"]').should('have.value', 'csrf-tok');
    });
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

  it('renders an IdP badge when idpName is present', () => {
    mountAccounts({ csrfToken: 't', accounts: [account({ idpName: 'Google' })] });
    cy.contains('Google').should('exist');
  });

  it('threads organization (alongside requestId) through the switch/remove hidden inputs and "Add another account" (regression: organization silently dropped)', () => {
    mountAccounts({
      csrfToken: 'csrf-tok',
      accounts: [account()],
      requestId: 'oidc_V2_123',
      organization: 'org-1',
      userCode: null,
      reauthMismatch: false,
    });
    cy.get('form:has(input[name="intent"][value="switch"])').within(() => {
      cy.get('input[name="requestId"]').should('have.value', 'oidc_V2_123');
      cy.get('input[name="organization"]').should('have.value', 'org-1');
    });
    cy.get('form:has(input[name="intent"][value="remove"])').within(() => {
      cy.get('input[name="requestId"]').should('have.value', 'oidc_V2_123');
      cy.get('input[name="organization"]').should('have.value', 'org-1');
    });
    cy.contains('a', 'Add another account').should(
      'have.attr',
      'href',
      '/login?requestId=oidc_V2_123&organization=org-1'
    );
  });
});
