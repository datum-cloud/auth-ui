// cypress/component/routes/accounts-remove-confirm.cy.tsx
//
// Removing an account from the picker used to submit on the first click of an unnamed trash
// icon (aria-label "Remove account" on every row) with no busy state. Pins the confirm dialog,
// the per-account accessible name, and the pending state of the confirm button.
import AccountPicker from '@/routes/accounts';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const account = (over: Record<string, unknown> = {}) => ({
  sessionId: 's1',
  loginName: 'alice@acme.test',
  organization: 'org-a',
  displayName: 'Alice',
  nextPath: '/signed-in',
  isActive: true,
  ...over,
});

const LOADER_DATA = {
  csrfToken: 'csrf-tok',
  accounts: [
    account(),
    // No displayName → the label falls back to the login name.
    account({ sessionId: 's2', loginName: 'bob@acme.test', displayName: undefined }),
  ],
  requestId: null,
  organization: undefined,
  userCode: null,
  reauthMismatch: false,
};

function mountAccounts(action: () => Promise<unknown> = async () => null) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const submitted = cy.stub().as('submitted');
  const router = createMemoryRouter(
    [
      {
        id: 'accounts',
        path: '/accounts',
        element: (
          <I18nProvider i18n={i18n}>
            <ConformAdapter>
              <AccountPicker />
            </ConformAdapter>
          </I18nProvider>
        ),
        action: async ({ request }) => {
          submitted(Object.fromEntries(await request.formData()));
          return action();
        },
        // Keeps post-action revalidation truthful (see passkeys-ui.cy.tsx).
        loader: async () => LOADER_DATA,
      },
    ],
    {
      initialEntries: ['/accounts'],
      hydrationData: { loaderData: { accounts: LOADER_DATA } },
    }
  );
  return mount(<RouterProvider router={router} />);
}

const removeForm = 'form:has(input[name="intent"][value="remove"])';

describe('/accounts — remove confirmation', () => {
  it('names each account in its remove control instead of a generic label', () => {
    mountAccounts();
    cy.findByRole('button', { name: 'Remove Alice' }).should('exist');
    cy.findByRole('button', { name: 'Remove bob@acme.test' }).should('exist');
    cy.get('button[aria-label="Remove account"]').should('not.exist');
  });

  it('does not submit on the trash click: it opens a dialog naming the account', () => {
    mountAccounts();
    // Radix unmounts dialog content while closed, so no remove form exists yet.
    cy.get(removeForm).should('not.exist');
    cy.findByRole('button', { name: 'Remove Alice' }).click();
    cy.contains('Remove this account?').should('be.visible');
    cy.contains('"Alice" will be signed out on this device.').should('be.visible');
    cy.get('@submitted').should('not.have.been.called');
  });

  it('cancel closes the dialog without removing anything', () => {
    mountAccounts();
    cy.findByRole('button', { name: 'Remove Alice' }).click();
    cy.contains('button', 'Cancel').click();
    cy.contains('Remove this account?').should('not.exist');
    cy.get('@submitted').should('not.have.been.called');
    cy.contains('Alice').should('be.visible');
  });

  it('confirm posts the remove intent for that row only, then closes the dialog', () => {
    mountAccounts();
    cy.findByRole('button', { name: 'Remove bob@acme.test' }).click();
    cy.get(removeForm).contains('button', 'Remove account').click();
    cy.get('@submitted').should('have.been.calledOnce');
    cy.get('@submitted').should('have.been.calledWithMatch', {
      intent: 'remove',
      sessionId: 's2',
      csrf: 'csrf-tok',
    });
    cy.contains('Remove this account?').should('not.exist');
  });

  it('shows a busy state on confirm and blocks cancel while the removal is in flight', () => {
    // Never resolves: holds the navigation in "submitting" so the pending UI can be asserted.
    mountAccounts(() => new Promise(() => {}));
    cy.findByRole('button', { name: 'Remove Alice' }).click();
    cy.get(removeForm)
      .contains('button', 'Remove account')
      .as('confirm')
      .should('not.be.disabled')
      .click();
    cy.get('@confirm').should('be.disabled');
    cy.contains('button', 'Cancel').should('be.disabled');
    cy.contains('Remove this account?').should('be.visible');
  });
});
