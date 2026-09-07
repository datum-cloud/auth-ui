// cypress/component/routes/verify/verify-resend-render.cy.tsx
//
// The resend control must not render without a userId. /verify is reachable with only
// ?loginName= (no userId), and the loader reads userId straight off the query — so the
// form posted userId='', which verifyCodeSchema's userId.min(1) rejects before the intent
// branch. The user saw INVALID_INPUT from a button that could not have worked.
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

const BASE_LOADER_DATA = {
  csrfToken: 'csrf-token-xyz',
  userId: '',
  invite: false,
  loginName: 'john.doe@example.com',
  organization: undefined,
  requestId: undefined,
  code: '',
};

function mountVerify(overrides: Partial<typeof BASE_LOADER_DATA> = {}) {
  const loaderData = { ...BASE_LOADER_DATA, ...overrides };
  const router = createMemoryRouter(
    [
      {
        id: 'verify',
        path: '/verify',
        element: <Verify />,
        action: async () => null,
        loader: () => loaderData,
      },
    ],
    {
      initialEntries: ['/verify'],
      hydrationData: { loaderData: { verify: loaderData } },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('verify — resend control', () => {
  it('does not offer resend when the page was reached without a userId', () => {
    mountVerify({ userId: '' });
    // Anchor on the primary submit — the verify page does not display the loginName.
    cy.contains('button', 'Verify', { timeout: 6000 });

    // The affordance itself must be gone — not merely disabled. A disabled button still
    // tells the user a resend exists; there is nothing here that could send one.
    cy.contains('button', 'Resend code').should('not.exist');
    cy.get('input[name="intent"][value="resend"]').should('not.exist');
  });

  it('still offers resend when a userId is present', () => {
    mountVerify({ userId: 'user-123' });
    // Anchor on the primary submit — the verify page does not display the loginName.
    cy.contains('button', 'Verify', { timeout: 6000 });

    // Guards the fix against over-correction: the legitimate /verify?userId=… path keeps
    // its resend, and the hidden input still carries the id the action requires.
    cy.contains('button', 'Resend code').should('exist');
    cy.get('input[name="intent"][value="resend"]').should('exist');
    cy.get('input[name="userId"]').should('have.value', 'user-123');
  });
});
