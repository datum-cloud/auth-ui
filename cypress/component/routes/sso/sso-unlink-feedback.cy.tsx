// cypress/component/routes/sso/sso-unlink-feedback.cy.tsx
//
// The /sso page never read its action data, so a failed unlink (sso-action.ts returns
// `{ error: 'provider_error' }` with a 502) left the user looking at an unchanged list with no
// explanation, and the confirm button gave no sign a request was in flight. Pins the inline
// error and the pending state of the confirm dialog.
import SsoIndex from '@/routes/sso/index';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const LOADER_DATA = {
  csrfToken: 'csrf-mgmt',
  userId: 'u1',
  loginName: 'you@acme.test',
  linked: [
    {
      idpId: 'gh',
      idpUserId: 'gh-1',
      idpUserName: 'a-handle',
      name: 'GitHub',
      type: 'GITHUB',
      unlinkable: true,
    },
    {
      idpId: 'g',
      idpUserId: 'g-1',
      idpUserName: 'you@gmail.com',
      name: 'Google',
      type: 'GOOGLE',
      unlinkable: true,
    },
  ],
  linkable: [],
  allowUnlink: true,
};

const FAILURE = "We couldn't unlink that account. Please try again.";

/** `action` is what a real unlink POST resolves to; omit `actionData` for a clean first paint. */
function mountSso(action: () => Promise<unknown> = async () => null, actionData?: unknown) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const router = createMemoryRouter(
    [
      {
        id: 'sso-index',
        path: '/sso',
        element: (
          <I18nProvider i18n={i18n}>
            <ConformAdapter>
              <SsoIndex />
            </ConformAdapter>
          </I18nProvider>
        ),
        action,
        // Keeps post-action revalidation truthful (see passkeys-ui.cy.tsx).
        loader: async () => LOADER_DATA,
      },
    ],
    {
      initialEntries: ['/sso'],
      hydrationData: {
        loaderData: { 'sso-index': LOADER_DATA },
        ...(actionData !== undefined ? { actionData: { 'sso-index': actionData } } : {}),
      },
    }
  );
  return mount(<RouterProvider router={router} />);
}

/** Opens the confirm dialog for the first connected row (GitHub). */
function openGithubDialog() {
  cy.contains('li', 'GitHub').contains('button', 'Unlink').click();
  cy.contains('Unlink GitHub?').should('be.visible');
}

describe('/sso — unlink failure feedback', () => {
  it('shows no error on a clean first paint', () => {
    mountSso();
    cy.contains('Linked accounts').should('be.visible');
    cy.findByRole('alert').should('not.exist');
  });

  it('renders the provider_error action result as an inline alert', () => {
    mountSso(undefined, { error: 'provider_error' });
    cy.findByRole('alert').should('be.visible').and('have.text', FAILURE);
  });

  it('closes the dialog and shows the error when a submitted unlink fails', () => {
    mountSso(async () => ({ error: 'provider_error' }));
    openGithubDialog();
    cy.get('form:has(input[name="intent"][value="unlink"])').find('button[type="submit"]').click();
    // The dialog closes so the alert is not hidden behind the overlay.
    cy.contains('Unlink GitHub?').should('not.exist');
    cy.findByRole('alert').should('be.visible').and('have.text', FAILURE);
    // The link is still listed — nothing was removed.
    cy.contains('li', 'GitHub').should('be.visible');
  });
});

describe('/sso — unlink pending state', () => {
  it('disables the confirm and cancel buttons while the unlink is in flight', () => {
    // Never resolves: holds the navigation in "submitting" so the pending UI can be asserted.
    mountSso(() => new Promise(() => {}));
    openGithubDialog();
    cy.get('form:has(input[name="intent"][value="unlink"])')
      .find('button[type="submit"]')
      .as('confirm')
      .should('not.be.disabled')
      .click();
    cy.get('@confirm').should('be.disabled');
    cy.contains('button', 'Cancel').should('be.disabled');
    // The dialog stays open while pending.
    cy.contains('Unlink GitHub?').should('be.visible');
  });
});
