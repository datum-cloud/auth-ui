// cypress/component/routes/device/authorize-recovery.cy.tsx
//
// Render port of app/routes/device/__tests__/authorize.recovery.test.tsx.
// Pins the tailored in-component recovery card that renders when the loader
// carries a recovery error (missing/stale user_code). Asserts the route does NOT
// fall through to the generic root ErrorBoundary.
import DeviceAuthorize from '@/routes/device/authorize';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

function withI18n(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return <I18nProvider i18n={i18n}>{node}</I18nProvider>;
}

function mountWithLoaderData(loaderData: unknown) {
  const router = createMemoryRouter(
    [{ id: 'device-authorize', path: '/device/authorize', element: <DeviceAuthorize /> }],
    {
      initialEntries: ['/device/authorize'],
      hydrationData: { loaderData: { 'device-authorize': loaderData } },
    }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('device/authorize — tailored recovery (missing/stale user_code)', () => {
  it('renders a heading and an "Enter a new code" link back to /device', () => {
    mountWithLoaderData({ error: { code: 'INVALID_INPUT', recovery: 'device' } });
    cy.findByRole('heading', { level: 1 }).should('exist');
    cy.findByText('Enter a new code').closest('a').should('have.attr', 'href', '/device');
  });

  it('does NOT render Authorize or Deny consent buttons on the recovery page', () => {
    mountWithLoaderData({ error: { code: 'INVALID_INPUT', recovery: 'device' } });
    cy.findByRole('button', { name: /authorize/i }).should('not.exist');
    cy.findByRole('button', { name: /deny/i }).should('not.exist');
  });
});
