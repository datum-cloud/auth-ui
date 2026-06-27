// cypress/component/routes/login/login-render.cy.tsx
//
// Render adoption port of app/routes/login/__tests__/login-render.test.tsx.
//
// Pins: AuthCeremony layout, AuthFormFields hidden-input cluster, OtpCodeField, inline error alert.
// Uses createMemoryRouter + hydrationData — no vi.mock needed; the real hooks work under Cypress.
import Login from '@/routes/login/index';
import LoginPasskey from '@/routes/login/passkey';
import VerifyAuthenticator from '@/routes/login/verify/authenticator';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const LOGIN_CONTEXT = {
  loginName: 'alice@acme.test',
  requestId: 'rq-123',
  organization: 'acme',
};
const OTP_LOADER_DATA = { csrfToken: 'csrf-token-xyz' };
const PASSKEY_LOADER_DATA = {
  csrfToken: 'csrf-token-xyz',
  loginName: 'alice@acme.test',
  requestId: 'rq-123',
  organization: 'acme',
  publicKeyCredentialRequestOptions: null,
};
const LOGIN_INDEX_LOADER_DATA = {
  csrfToken: 'csrf-token-xyz',
  idps: [{ id: 'idp-1', name: 'Google' }],
  settings: {
    allowPassword: true,
    allowRegister: true,
    allowExternalIdp: true,
    passkeysType: 'not_allowed',
    disableLoginWithEmail: false,
    disableLoginWithPhone: false,
  },
  branding: null,
  emailDeliveryEnabled: false,
  notice: undefined,
  lastUsedLogin: null,
};

function withI18n(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

function mountChildRoute(
  path: string,
  childId: string,
  Component: React.ComponentType,
  loaderData: unknown,
  actionData?: unknown
) {
  const router = createMemoryRouter(
    [
      {
        id: 'login',
        path: '/login',
        loader: () => LOGIN_CONTEXT,
        children: [
          {
            id: childId,
            path: path.replace('/login/', ''),
            element: <Component />,
          },
        ],
      },
    ],
    {
      initialEntries: [path],
      hydrationData: {
        loaderData: { login: LOGIN_CONTEXT, [childId]: loaderData },
        ...(actionData !== undefined ? { actionData: { [childId]: actionData } } : {}),
      },
    }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

// ── VerifyAuthenticator ──────────────────────────────────────────────────────

describe('login/verify/authenticator — render adoption', () => {
  it('wraps the screen in the AuthCeremony layout (owned tokenized spacing div)', () => {
    mountChildRoute('/login/verify/authenticator', 'va', VerifyAuthenticator, OTP_LOADER_DATA);
    cy.contains('alice@acme.test').should('exist');
    cy.get('div.flex.flex-col.items-baseline.justify-center.gap-4').should('exist');
  });

  it('emits the shared csrf + identity hidden inputs from AuthFormFields in fixed order', () => {
    mountChildRoute('/login/verify/authenticator', 'va', VerifyAuthenticator, OTP_LOADER_DATA);
    cy.contains('alice@acme.test').should('exist');
    cy.get('form input[type="hidden"]').then(($inputs) => {
      const hidden = $inputs.toArray().map((i) => ({
        name: i.getAttribute('name'),
        value: i.getAttribute('value'),
      }));
      expect(hidden).to.deep.equal([
        { name: 'csrf', value: 'csrf-token-xyz' },
        { name: 'loginName', value: 'alice@acme.test' },
        { name: 'requestId', value: 'rq-123' },
        { name: 'organization', value: 'acme' },
      ]);
    });
  });

  it('mounts the schema-validated OtpCodeField (datum-ui Form.Field, not a bare input)', () => {
    mountChildRoute('/login/verify/authenticator', 'va', VerifyAuthenticator, OTP_LOADER_DATA);
    // @testing-library/cypress adds findByLabelText
    cy.findByLabelText(/Authenticator code/).then(($input) => {
      expect($input.attr('name')).to.equal('code');
      expect($input.attr('inputmode')).to.equal('numeric');
      expect($input.attr('autocomplete')).to.equal('one-time-code');
      expect($input.attr('data-slot')).to.equal('input');
    });
  });

  it('threads the resolved action-error message INLINE as role="alert" (toast → inline)', () => {
    mountChildRoute('/login/verify/authenticator', 'va', VerifyAuthenticator, OTP_LOADER_DATA, {
      error: 'INVALID_CREDENTIALS',
    });
    cy.findByRole('alert').should('contain', 'Incorrect credentials. Please try again.');
  });
});

// ── LoginPasskey ─────────────────────────────────────────────────────────────

describe('login/passkey — render adoption', () => {
  it('wraps the screen in AuthCeremony and emits the AuthFormFields cluster + credential input', () => {
    mountChildRoute('/login/passkey', 'pk', LoginPasskey, PASSKEY_LOADER_DATA);
    cy.contains('alice@acme.test').should('exist');
    cy.get('div.flex.flex-col.items-baseline.justify-center.gap-4').should('exist');
    cy.get('form input[type="hidden"]').then(($inputs) => {
      const names = $inputs.toArray().map((i) => i.getAttribute('name'));
      expect(names).to.deep.equal(['csrf', 'loginName', 'requestId', 'organization', 'credential']);
    });
  });
});

// ── login/index (SplitLayout welcome chooser) ────────────────────────────────

function mountLoginIndex(loaderOverride?: Record<string, unknown>, actionData?: unknown) {
  const loaderData = { ...LOGIN_INDEX_LOADER_DATA, ...loaderOverride };
  const router = createMemoryRouter(
    [
      {
        id: 'login',
        path: '/login',
        loader: () => LOGIN_CONTEXT,
        children: [
          {
            id: 'login-index',
            index: true,
            element: <Login />,
          },
        ],
      },
    ],
    {
      initialEntries: ['/login'],
      hydrationData: {
        loaderData: { login: LOGIN_CONTEXT, 'login-index': loaderData },
        ...(actionData !== undefined ? { actionData: { 'login-index': actionData } } : {}),
      },
    }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('login/index — render adoption', () => {
  it('emits the AuthFormFields identity cluster (csrf → requestId → organization) on the IdP form', () => {
    mountLoginIndex();
    cy.contains('Google').should('exist');
    cy.get('form')
      .first()
      .find('input[type="hidden"]')
      .then(($inputs) => {
        const hidden = $inputs.toArray().map((i) => ({
          name: i.getAttribute('name'),
          value: i.getAttribute('value'),
        }));
        expect(hidden).to.deep.equal([
          { name: 'csrf', value: 'csrf-token-xyz' },
          { name: 'requestId', value: 'rq-123' },
          { name: 'organization', value: 'acme' },
          { name: 'intent', value: 'idp' },
          { name: 'idpId', value: 'idp-1' },
        ]);
      });
  });

  it('emits the AuthFormFields cluster on the revealed identifier form', () => {
    mountLoginIndex();
    cy.contains('Email').click();
    cy.get('form')
      .filter(':has(input[name="loginName"])')
      .find('input[type="hidden"]')
      .then(($inputs) => {
        const hidden = $inputs.toArray().map((i) => ({
          name: i.getAttribute('name'),
          value: i.getAttribute('value'),
        }));
        expect(hidden).to.deep.equal([
          { name: 'csrf', value: 'csrf-token-xyz' },
          { name: 'requestId', value: 'rq-123' },
          { name: 'organization', value: 'acme' },
        ]);
      });
  });

  it('surfaces the action-error message INLINE as role="alert" (toast → inline)', () => {
    mountLoginIndex(undefined, { error: 'USER_NOT_FOUND' });
    cy.findByRole('alert').should('contain', 'We could not find an account for that identifier.');
  });

  describe('F2 — IdP buttons render only for configured providers', () => {
    it('renders the configured Google IdP button when one Google IdP is active', () => {
      mountLoginIndex({ idps: [{ id: 'idp-1', name: 'Google' }] });
      cy.findByRole('button', { name: 'Google' }).should('exist');
    });

    it('renders NO Google/social IdP button when no IdP is configured', () => {
      mountLoginIndex({ idps: [] });
      cy.contains('Email').should('exist');
      cy.contains('Create account').should('exist');
      cy.findByRole('button', { name: 'Google' }).should('not.exist');
    });
  });
});
