// cypress/component/routes/recover/entry-points.cy.tsx
//
// MOUNT: the four doors into recovery. Every one of them renders ONLY when
// AUTH_ACCOUNT_RECOVERY_ENABLED is on — merging is not activating, so a link to a 404 must never
// appear. Each case is asserted in both polarities for that reason.
import ErrorScreen from '@/routes/error';
import Verify from '@/routes/verify/index';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { RouterProvider, createMemoryRouter } from 'react-router';

function withProviders(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

function mountAt(
  Component: React.ComponentType,
  routeId: string,
  path: string,
  loaderData: unknown,
  actionData?: unknown
) {
  // The route's `path` is the pathname only; the query rides on initialEntries, which is what
  // useSearchParams reads.
  const router = createMemoryRouter(
    [
      { id: routeId, path: path.split('?')[0], element: <Component /> },
      { id: 'recover', path: '/recover', element: <div /> },
    ],
    {
      initialEntries: [path],
      hydrationData: {
        loaderData: { [routeId]: loaderData },
        ...(actionData !== undefined ? { actionData: { [routeId]: actionData } } : {}),
      },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('/error — the recovery CTA', () => {
  const path = '/error?code=no_supported_method&loginName=owner%40acme.test&requestId=req-1';

  it('offers recovery for a methodless account when the flag is on', () => {
    mountAt(ErrorScreen, 'error', path, { recoveryEnabled: true });
    cy.contains('No sign-in method available').should('exist');
    cy.contains('Recover your account').should('exist');
    // The address and the OIDC request are threaded so the flow resumes where it broke.
    cy.get('a[href*="/recover"]')
      .should('have.attr', 'href')
      .and('contain', 'email=owner%40acme.test')
      .and('contain', 'requestId=req-1');
  });

  it('renders no CTA when the flag is off', () => {
    mountAt(ErrorScreen, 'error', path, { recoveryEnabled: false });
    cy.contains('No sign-in method available').should('exist');
    cy.contains('Recover your account').should('not.exist');
  });

  it('renders no CTA for a DIFFERENT error code, even with the flag on', () => {
    // Keyed on the code, never on the rendered text.
    mountAt(ErrorScreen, 'error', '/error?code=access_denied', { recoveryEnabled: true });
    cy.contains('Access denied').should('exist');
    cy.contains('Recover your account').should('not.exist');
  });
});

describe('/verify — the "didn\'t get the email?" pointer', () => {
  const loaderData = {
    csrfToken: 'c',
    userId: 'u-1',
    invite: undefined,
    loginName: 'owner@acme.test',
    organization: undefined,
    requestId: undefined,
    code: '',
    recoveryEnabled: true,
  };

  it('points a stuck class-(d) user at recovery when the flag is on', () => {
    mountAt(Verify, 'verify', '/verify', loaderData);
    cy.contains('Recover your account').should('exist');
    cy.get('a[href*="/recover"]')
      .should('have.attr', 'href')
      .and('contain', 'email=owner%40acme.test');
  });

  it('renders nothing when the flag is off', () => {
    mountAt(Verify, 'verify', '/verify', { ...loaderData, recoveryEnabled: false });
    cy.contains('Recover your account').should('not.exist');
  });
});
