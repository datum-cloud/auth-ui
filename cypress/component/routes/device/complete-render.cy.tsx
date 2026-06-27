// cypress/component/routes/device/complete-render.cy.tsx
//
// Render port of app/routes/device/__tests__/complete.render.test.tsx.
// Pins the terminal decision screen: authorize → success card, deny → denied card.
import DeviceComplete from '@/routes/device/complete';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

function withI18n(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return <I18nProvider i18n={i18n}>{node}</I18nProvider>;
}

function mountWithDecision(decision: 'authorize' | 'deny') {
  const router = createMemoryRouter(
    [{ id: 'device-complete', path: '/device/complete', element: <DeviceComplete /> }],
    {
      initialEntries: ['/device/complete'],
      hydrationData: { loaderData: { 'device-complete': { decision } } },
    }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('device/complete — terminal render', () => {
  it('authorize → renders the "Authorization complete" success card', () => {
    mountWithDecision('authorize');
    cy.contains('Authorization complete').should('exist');
    cy.contains('You may return to your device.').should('exist');
  });

  it('deny → renders a clear denied message', () => {
    mountWithDecision('deny');
    cy.contains('Device denied').should('exist');
  });

  it('renders no Authorize/Deny consent buttons on either terminal screen', () => {
    mountWithDecision('authorize');
    cy.findByRole('button', { name: /authorize/i }).should('not.exist');
    cy.findByRole('button', { name: /deny/i }).should('not.exist');
  });
});
