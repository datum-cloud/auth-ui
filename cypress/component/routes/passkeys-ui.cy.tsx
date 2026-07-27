// cypress/component/routes/passkeys-ui.cy.tsx
//
// UI contract for /id/passkeys: trash-icon remove trigger (confirm dialog kept),
// badge only when inactive, post-delete "sign out other sessions?" dialog
// (reshaped from an inline alert), designed empty state, one-time "Passkey added." notice.
// Mounted with hydrationData (no loader function — render-only, like setup-render.cy.tsx).
import Passkeys from '@/routes/passkeys';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

type Row = { id: string; state: 'active' | 'inactive'; name: string; createdAt?: string };

const BASE_LOADER = {
  csrfToken: 'tok-1',
  view: {
    passkeys: [{ id: 'pk1', state: 'active', name: 'Seeded laptop' }] as Row[],
    methodCount: 2,
    loginName: 'mia@acme.test',
    returnTo: null,
  },
  added: false,
};

function mountPasskeys(
  loaderOverrides?: Partial<typeof BASE_LOADER>,
  actionData?: unknown,
  // What a real form submission returns (e.g. { error: 'LAST_METHOD' } for a refusal).
  actionResult: unknown = null
) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const router = createMemoryRouter(
    [
      {
        id: 'passkeys',
        path: '/passkeys',
        element: (
          <I18nProvider i18n={i18n}>
            <ConformAdapter>
              <Passkeys />
            </ConformAdapter>
          </I18nProvider>
        ),
        action: async () => actionResult,
        // Deviation (not in the reviewer's fix text): without a loader, React Router's
        // post-action revalidation leaves useLoaderData() undefined and the route crashes
        // (caught by RR's default ErrorBoundary), which made the new "sign-out submit
        // closes the dialog" test pass for the wrong reason — the whole page unmounts,
        // not our close logic. Returning the same data hydration already seeded keeps
        // revalidation truthful (mirrors the real redirect-to-same-route-and-reload).
        loader: async () => ({ ...BASE_LOADER, ...loaderOverrides }),
      },
    ],
    {
      initialEntries: ['/passkeys'],
      hydrationData: {
        loaderData: { passkeys: { ...BASE_LOADER, ...loaderOverrides } },
        ...(actionData !== undefined ? { actionData: { passkeys: actionData } } : {}),
      },
    }
  );
  return mount(<RouterProvider router={router} />);
}

describe('/id/passkeys — UI contract', () => {
  it('active row: no badge, trash trigger with aria-label opens the danger confirm dialog', () => {
    mountPasskeys();
    cy.contains('Seeded laptop').should('be.visible');
    cy.contains('Active').should('not.exist');
    cy.get('button[aria-label="Remove Seeded laptop"]').should('exist').click();
    cy.contains('Remove this passkey?').should('be.visible');
    cy.contains('button', 'Remove passkey').should('be.visible');
  });

  it('inactive row keeps a muted Inactive badge', () => {
    mountPasskeys({
      view: {
        ...BASE_LOADER.view,
        passkeys: [{ id: 'pk2', state: 'inactive', name: 'Stuck enrollment' }],
      },
    });
    cy.contains('Inactive').should('be.visible');
  });

  it('successful removal opens the sign-out-others dialog; Not now closes it', () => {
    mountPasskeys(undefined, { removed: 'Seeded laptop' });
    cy.contains('Passkey removed').should('be.visible');
    cy.contains('button', 'Sign out other sessions').should('be.visible');
    cy.contains('button', 'Not now').click();
    cy.contains('Passkey removed').should('not.exist');
    // The page (list) is still there — no navigation happened.
    cy.contains('Seeded laptop').should('be.visible');
  });

  it('sign-out submit closes the dialog when the action result lands', () => {
    mountPasskeys(undefined, { removed: 'Seeded laptop' });
    cy.contains('Passkey removed').should('be.visible');
    cy.contains('button', 'Sign out other sessions').click();
    cy.contains('Passkey removed').should('not.exist');
  });

  it('remove refusal (LAST_METHOD) closes the confirm dialog so the inline error is visible', () => {
    mountPasskeys({ view: { ...BASE_LOADER.view, methodCount: 1 } }, undefined, {
      error: 'LAST_METHOD',
    });
    cy.get('button[aria-label="Remove Seeded laptop"]').click();
    cy.contains('Remove this passkey?').should('be.visible');
    cy.contains('button', 'Remove passkey').click();
    // The refusal must not hide behind the modal overlay.
    cy.contains('Remove this passkey?').should('not.exist');
    cy.contains("You can't remove your only sign-in method").should('be.visible');
  });

  it('empty list renders the minimal empty state', () => {
    mountPasskeys({ view: { ...BASE_LOADER.view, passkeys: [] } });
    cy.contains('No passkeys yet.').should('be.visible');
    cy.get('ul').should('not.exist');
  });

  it('shows the active login name, a "Use a different account" switch link, and a sign-out action', () => {
    mountPasskeys();
    cy.contains('Logged in as').should('be.visible');
    cy.contains('mia@acme.test').should('be.visible');
    cy.findByRole('link', { name: /use a different account/i }).should(
      'have.attr',
      'href',
      '/accounts'
    );
    cy.contains('button', 'Sign out').should('be.visible');
  });

  it('row with createdAt renders the muted "Added <date>" second line', () => {
    const createdAt = '2026-07-21T10:00:00.000Z';
    // Same Intl path the app uses — deterministic across CI timezones.
    const expected = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
      new Date(createdAt)
    );
    mountPasskeys({
      view: {
        ...BASE_LOADER.view,
        passkeys: [{ id: 'pk1', state: 'active', name: 'Seeded laptop', createdAt }],
      },
    });
    // Styling contract: the date line must carry the muted/small-text treatment.
    cy.contains(`Added ${expected}`)
      .should('be.visible')
      .and('have.class', 'text-muted-foreground')
      .and('have.class', 'text-xs');
  });

  it('row without createdAt renders no Added line (no created-at metadata)', () => {
    mountPasskeys();
    cy.contains('Seeded laptop').should('be.visible');
    cy.contains('Added ').should('not.exist');
  });

  it('inactive row with createdAt renders both the Inactive badge and the Added line', () => {
    const createdAt = '2026-07-15T08:30:00.000Z';
    const expected = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
      new Date(createdAt)
    );
    mountPasskeys({
      view: {
        ...BASE_LOADER.view,
        passkeys: [{ id: 'pk2', state: 'inactive', name: 'Stuck enrollment', createdAt }],
      },
    });
    cy.contains('Inactive').should('be.visible');
    cy.contains(`Added ${expected}`).should('be.visible');
  });
});
