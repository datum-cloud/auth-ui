// cypress/component/routes/setup/setup-render.cy.tsx
//
// MOUNT: setup-domain render sweep — final squeeze pass.
// Migrated from: app/routes/setup/__tests__/setup-render.test.tsx
//
// Keeps ONE merged inline-error/recovery-link test (setup/email + setup/authenticator,
// covering both the recoverable and non-recoverable branches), one representative hidden-input
// wiring test (setup/passkey), the F4 decorative-icon accessibility assertion, and the
// mfa-suppression BackLink case. The equivalent per-route repetition across setup/sms,
// setup/security-key, and the remaining setup/mfa/authenticator variants is not
// duplicated here — they share the same AuthFormFields/inline-error primitives already
// pinned once below.
import SetupAuthenticator from '@/routes/setup/authenticator';
import SetupEmail from '@/routes/setup/email';
import SetupMfa from '@/routes/setup/mfa';
import SetupPasskey from '@/routes/setup/passkey';
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

function mountRoute(
  Component: React.ComponentType,
  segment: string,
  loaderData: unknown,
  actionData?: unknown
) {
  const routeId = `setup-${segment}`;
  const path = `/setup/${segment}`;
  const router = createMemoryRouter([{ id: routeId, path, element: <Component /> }], {
    initialEntries: [path],
    hydrationData: {
      loaderData: { [routeId]: loaderData },
      ...(actionData !== undefined ? { actionData: { [routeId]: actionData } } : {}),
    },
  });
  return mount(withProviders(<RouterProvider router={router} />));
}

const IDENTITY = {
  csrfToken: 'tok-1',
  loginName: 'a@b.test',
  requestId: 'rq1',
  organization: 'acme',
  force: undefined as 'true' | 'false' | undefined,
  checkAfter: undefined as 'true' | 'false' | undefined,
};

function hiddenInputs() {
  return cy.get('input[type="hidden"]');
}

describe('setup/email & setup/authenticator — shared inline-error primitive', () => {
  it('surfaces an action error inline (role="alert") with a recovery link only when the error is recoverable', () => {
    // Recoverable: SESSION_EXPIRED renders the "Sign in again" recovery link, preserving the ceremony.
    mountRoute(SetupEmail, 'email', { ...IDENTITY }, { error: 'SESSION_EXPIRED' });
    cy.get('[role="alert"]').should('exist');
    cy.contains('a', 'Sign in again').should(
      'have.attr',
      'href',
      '/login?requestId=rq1&organization=acme'
    );

    // Non-recoverable: INVALID_CREDENTIALS renders NO recovery link at all.
    const loaderData = { ...IDENTITY, uri: 'otpauth://totp/x', secret: 'ABC123' };
    mountRoute(SetupAuthenticator, 'authenticator', loaderData, { error: 'INVALID_CREDENTIALS' });
    cy.get('[role="alert"]').should('exist');
    cy.contains('a', 'Sign in again').should('not.exist');
    cy.contains('a', 'Start over').should('not.exist');
  });
});

describe('setup/passkey — shared primitive adoption', () => {
  const loaderData = { ...IDENTITY, credentialId: 'pk1', publicKey: {}, challengeFailed: false };

  it('emits csrf + identity + passkeyId/credential hidden inputs', () => {
    mountRoute(SetupPasskey, 'passkey', loaderData);
    cy.contains(/Set up passkey/i).should('exist');
    hiddenInputs().then(($inputs) => {
      const names = [...$inputs].map((el) => el.getAttribute('name'));
      expect(names).to.include('csrf');
      expect(names).to.include('loginName');
      expect(names).to.include('requestId');
      expect(names).to.include('organization');
      expect(names).to.include('passkeyId');
      expect(names).to.include('credential');
    });
  });
});

describe('setup/mfa — shared primitive adoption', () => {
  describe('F4 — Authenticator app link is announced once (decorative icon)', () => {
    const totpLoader = { ...IDENTITY, offerableKeys: ['totpOtp', 'emailOtp'] };

    it('renders the Authenticator icon as a decorative img (alt="" + aria-hidden)', () => {
      mountRoute(SetupMfa, 'mfa', totpLoader);
      cy.get('img[src*="totp.png"]')
        .should('have.attr', 'alt', '')
        .and('have.attr', 'aria-hidden', 'true');
    });
  });
});

describe('setup/* — BackLink renders to the predecessor', () => {
  it('setup/mfa suppresses the Back link (entry step)', () => {
    mountRoute(SetupMfa, 'mfa', { ...IDENTITY, offerableKeys: ['passkey'] });
    cy.get('a[href*="/login/password"]').should('not.exist');
  });

  it('clicking Back on /setup/passkey does not disable "Register passkey" while the predecessor loads', () => {
    // Regression: WebAuthnButton's busy state defaulted to navigation.state !== 'idle',
    // which is also true for an UNRELATED Link navigation elsewhere on the page (the
    // BackLink). Registers a real /setup/mfa route whose loader never resolves, so the
    // Back navigation stays pending — proving the CURRENT page's WebAuthnButton stays
    // interactive throughout, since it has nothing to do with that click.
    const router = createMemoryRouter(
      [
        { id: 'setup-passkey', path: '/setup/passkey', element: <SetupPasskey /> },
        {
          id: 'setup-mfa',
          path: '/setup/mfa',
          element: <SetupMfa />,
          loader: () => new Promise(() => {}),
        },
      ],
      {
        initialEntries: ['/setup/passkey'],
        hydrationData: {
          loaderData: {
            'setup-passkey': {
              ...IDENTITY,
              credentialId: 'pk1',
              publicKey: null,
              challengeFailed: false,
            },
          },
        },
      }
    );
    mount(withProviders(<RouterProvider router={router} />));

    cy.contains('button', 'Register passkey').should('not.be.disabled');
    cy.contains('a', 'Back').click();
    cy.contains('button', 'Register passkey').should('not.be.disabled');
  });
});
