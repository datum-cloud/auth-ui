// cypress/component/routes/device/authorize-scopes.cy.tsx
//
// Device consent used to list raw OAuth scope identifiers ("openid", "offline_access"), which
// tell most people nothing about what they are granting. Pins that the standard OIDC scopes
// render as plain-language descriptions and that an unrecognised scope keeps its raw
// identifier, so nothing being granted is hidden or guessed at.
import DeviceAuthorize from '@/routes/device/authorize';
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

function mountAuthorize(scope: string[]) {
  const router = createMemoryRouter(
    [{ id: 'device-authorize', path: '/device/authorize', element: <DeviceAuthorize /> }],
    {
      initialEntries: ['/device/authorize'],
      hydrationData: {
        loaderData: {
          'device-authorize': {
            csrfToken: 'tok-1',
            appName: 'Acme CLI',
            scope,
            deviceAuthId: 'da-1',
            requestId: 'device_ABC123',
            activeLoginName: 'mia@acme.test',
          },
        },
      },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('/device/authorize — scope descriptions', () => {
  it('describes every known scope in plain language instead of its raw identifier', () => {
    mountAuthorize(['openid', 'profile', 'email', 'phone', 'address', 'offline_access']);
    cy.findByRole('list', { name: 'Requested access' }).within(() => {
      cy.findAllByRole('listitem').should('have.length', 6);
      cy.contains('li', 'Confirm your identity').should('be.visible');
      cy.contains('li', 'View your name and profile details').should('be.visible');
      cy.contains('li', 'View your email address').should('be.visible');
      cy.contains('li', 'View your phone number').should('be.visible');
      cy.contains('li', 'View your postal address').should('be.visible');
      cy.contains('li', 'Stay signed in without asking you again').should('be.visible');
      cy.contains('openid').should('not.exist');
      cy.contains('offline_access').should('not.exist');
    });
  });

  it('falls back to the raw identifier for an unknown scope', () => {
    mountAuthorize(['email', 'urn:acme:billing:read']);
    cy.findByRole('list', { name: 'Requested access' }).within(() => {
      cy.contains('li', 'View your email address').should('be.visible');
      cy.contains('li', 'urn:acme:billing:read').should('be.visible');
    });
  });

  it('renders no list at all when no scopes were requested', () => {
    mountAuthorize([]);
    cy.contains('Authorize device').should('be.visible');
    cy.findByRole('list', { name: 'Requested access' }).should('not.exist');
  });
});
