// cypress/component/routes/setup/setup-render.cy.tsx
//
// MOUNT: setup-domain render sweep across 6 setup leaf routes.
// Migrated from: app/routes/setup/__tests__/setup-render.test.tsx
//
// Pins shared-primitive adoption (AuthFormFields hidden inputs, inline error banners,
// OtpCodeField, BackLink). Uses createMemoryRouter + hydrationData instead of vi.mock.
//
// Note: WebAuthnButton (passkey/security-key) is rendered as-is; we pin DOM structure
// (hidden inputs, submit button existence) without triggering navigator.credentials.
import SetupAuthenticator from '@/routes/setup/authenticator';
import SetupEmail from '@/routes/setup/email';
import SetupMfa from '@/routes/setup/mfa';
import SetupPasskey from '@/routes/setup/passkey';
import SetupSecurityKey from '@/routes/setup/security-key';
import SetupSms from '@/routes/setup/sms';
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

describe('setup/email — shared primitive adoption', () => {
  it('emits byte-identical csrf + identity hidden inputs via AuthFormFields', () => {
    mountRoute(SetupEmail, 'email', { ...IDENTITY });
    cy.contains(/Set up email one-time code/i).should('exist');
    hiddenInputs().then(($inputs) => {
      const pairs = [...$inputs].map((el) => ({
        name: el.getAttribute('name'),
        value: el.getAttribute('value'),
      }));
      expect(pairs).to.deep.include({ name: 'csrf', value: 'tok-1' });
      expect(pairs).to.deep.include({ name: 'loginName', value: 'a@b.test' });
      expect(pairs).to.deep.include({ name: 'requestId', value: 'rq1' });
      expect(pairs).to.deep.include({ name: 'organization', value: 'acme' });
    });
  });

  it('surfaces an action error inline (role="alert"), not as a toast', () => {
    mountRoute(SetupEmail, 'email', { ...IDENTITY }, { error: 'SESSION_EXPIRED' });
    cy.get('[role="alert"]').should('exist');
  });

  it('renders an inline "Sign in again" recovery link preserving the ceremony on SESSION_EXPIRED', () => {
    mountRoute(SetupEmail, 'email', { ...IDENTITY }, { error: 'SESSION_EXPIRED' });
    cy.contains('a', 'Sign in again').should(
      'have.attr',
      'href',
      '/login?requestId=rq1&organization=acme'
    );
  });

  it('mounts the IdentityBadge for the threaded loginName', () => {
    mountRoute(SetupEmail, 'email', { ...IDENTITY });
    cy.contains('a@b.test').should('exist');
  });
});

describe('setup/sms — shared primitive adoption', () => {
  it('emits byte-identical csrf + identity hidden inputs via AuthFormFields', () => {
    mountRoute(SetupSms, 'sms', { ...IDENTITY });
    cy.contains(/Set up SMS one-time code/i).should('exist');
    hiddenInputs().then(($inputs) => {
      const names = [...$inputs].map((el) => el.getAttribute('name'));
      expect(names).to.include('csrf');
      expect(names).to.include('loginName');
      expect(names).to.include('requestId');
      expect(names).to.include('organization');
    });
  });

  it('surfaces an action error inline (role="alert")', () => {
    mountRoute(SetupSms, 'sms', { ...IDENTITY }, { error: 'SESSION_EXPIRED' });
    cy.get('[role="alert"]').should('exist');
  });

  it('renders an inline "Sign in again" recovery link on SESSION_EXPIRED', () => {
    mountRoute(SetupSms, 'sms', { ...IDENTITY }, { error: 'SESSION_EXPIRED' });
    cy.contains('a', 'Sign in again').should(
      'have.attr',
      'href',
      '/login?requestId=rq1&organization=acme'
    );
  });
});

describe('setup/authenticator — shared primitive adoption', () => {
  const loaderData = { ...IDENTITY, uri: 'otpauth://totp/x', secret: 'ABC123' };

  it('emits byte-identical csrf + identity hidden inputs via AuthFormFields', () => {
    mountRoute(SetupAuthenticator, 'authenticator', loaderData);
    cy.contains(/Set up authenticator app/i).should('exist');
    hiddenInputs().then(($inputs) => {
      const pairs = [...$inputs].map((el) => ({
        name: el.getAttribute('name'),
        value: el.getAttribute('value'),
      }));
      expect(pairs).to.deep.include({ name: 'csrf', value: 'tok-1' });
      expect(pairs).to.deep.include({ name: 'loginName', value: 'a@b.test' });
      expect(pairs).to.deep.include({ name: 'requestId', value: 'rq1' });
      expect(pairs).to.deep.include({ name: 'organization', value: 'acme' });
    });
  });

  it('renders a datum-ui OtpCodeField (numeric, one-time-code, data-slot="input")', () => {
    mountRoute(SetupAuthenticator, 'authenticator', loaderData);
    cy.contains(/Authenticator code/i).should('exist');
    cy.get('input[inputmode="numeric"][autocomplete="one-time-code"][data-slot="input"]').should(
      'exist'
    );
  });

  it('surfaces an action error inline (role="alert")', () => {
    mountRoute(SetupAuthenticator, 'authenticator', loaderData, { error: 'INVALID_CREDENTIALS' });
    cy.get('[role="alert"]').should('exist');
  });

  it('renders NO recovery link for a non-recoverable code (INVALID_CREDENTIALS)', () => {
    mountRoute(SetupAuthenticator, 'authenticator', loaderData, { error: 'INVALID_CREDENTIALS' });
    cy.get('[role="alert"]').should('exist');
    cy.contains('a', 'Sign in again').should('not.exist');
    cy.contains('a', 'Start over').should('not.exist');
  });

  it('renders a scannable QR for the otpauth URI above the manual-key fallback', () => {
    mountRoute(SetupAuthenticator, 'authenticator', loaderData);
    cy.contains(/Set up authenticator app/i).should('exist');
    cy.get('[data-testid="totp-qr"]').should('exist').and('have.prop', 'tagName', 'svg');
    cy.get('[data-testid="totp-secret"]').should('have.text', 'ABC123');
    cy.get('[data-testid="totp-uri"]').should('have.text', 'otpauth://totp/x');
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

  it('surfaces an action error inline (role="alert")', () => {
    mountRoute(SetupPasskey, 'passkey', loaderData, { error: 'INVALID_CREDENTIALS' });
    cy.get('[role="alert"]').should('exist');
  });
});

describe('setup/security-key — shared primitive adoption', () => {
  const loaderData = { ...IDENTITY, credentialId: 'u1', publicKey: {}, challengeFailed: false };

  it('emits csrf + identity + u2fId/credential hidden inputs', () => {
    mountRoute(SetupSecurityKey, 'security-key', loaderData);
    cy.contains(/Set up security key/i).should('exist');
    hiddenInputs().then(($inputs) => {
      const names = [...$inputs].map((el) => el.getAttribute('name'));
      expect(names).to.include('csrf');
      expect(names).to.include('loginName');
      expect(names).to.include('u2fId');
      expect(names).to.include('credential');
    });
  });

  it('surfaces an action error inline (role="alert")', () => {
    mountRoute(SetupSecurityKey, 'security-key', loaderData, { error: 'INVALID_CREDENTIALS' });
    cy.get('[role="alert"]').should('exist');
  });
});

describe('setup/mfa — shared primitive adoption', () => {
  const loaderData = { ...IDENTITY, offerableKeys: ['passkey', 'emailOtp'] };

  it('emits byte-identical csrf + identity hidden inputs in the Skip form via AuthFormFields', () => {
    mountRoute(SetupMfa, 'mfa', loaderData);
    cy.contains(/Set up multi-factor authentication/i).should('exist');
    hiddenInputs().then(($inputs) => {
      const pairs = [...$inputs].map((el) => ({
        name: el.getAttribute('name'),
        value: el.getAttribute('value'),
      }));
      expect(pairs).to.deep.include({ name: 'csrf', value: 'tok-1' });
      expect(pairs).to.deep.include({ name: 'loginName', value: 'a@b.test' });
      expect(pairs).to.deep.include({ name: 'requestId', value: 'rq1' });
      expect(pairs).to.deep.include({ name: 'organization', value: 'acme' });
    });
  });

  it('threads the shared query string into each chooser link', () => {
    mountRoute(SetupMfa, 'mfa', loaderData);
    cy.contains('a', 'Passkey')
      .invoke('attr', 'href')
      .then((href) => {
        expect(href).to.match(/^\/setup\/passkey\?/);
        expect(href).to.include('loginName=a%40b.test');
        expect(href).to.include('requestId=rq1');
        expect(href).to.include('organization=acme');
      });
  });

  it('surfaces an action error inline (role="alert")', () => {
    mountRoute(SetupMfa, 'mfa', loaderData, { error: 'SESSION_EXPIRED' });
    cy.get('[role="alert"]').should('exist');
  });

  it('renders an inline "Sign in again" recovery link on SESSION_EXPIRED', () => {
    mountRoute(SetupMfa, 'mfa', loaderData, { error: 'SESSION_EXPIRED' });
    cy.contains('a', 'Sign in again').should(
      'have.attr',
      'href',
      '/login?requestId=rq1&organization=acme'
    );
  });

  describe('F4 — Authenticator app link is announced once (decorative icon)', () => {
    const totpLoader = { ...IDENTITY, offerableKeys: ['totpOtp', 'emailOtp'] };

    it('exposes exactly one link named "Authenticator app"', () => {
      mountRoute(SetupMfa, 'mfa', totpLoader);
      cy.contains('a', 'Authenticator app').should('have.length', 1);
    });

    it('renders the Authenticator icon as a decorative img (alt="" + aria-hidden)', () => {
      mountRoute(SetupMfa, 'mfa', totpLoader);
      cy.get('img[src*="totp.png"]')
        .should('have.attr', 'alt', '')
        .and('have.attr', 'aria-hidden', 'true');
    });
  });
});

describe('setup/* — BackLink renders to the predecessor', () => {
  it('setup/authenticator renders a Back link', () => {
    mountRoute(SetupAuthenticator, 'authenticator', {
      ...IDENTITY,
      uri: 'otpauth://totp/x',
      secret: 'ABC123',
    });
    cy.get('a[href*="/setup/mfa"], a[href*="/login/password"]').should('exist');
  });

  it('setup/email renders a Back link', () => {
    mountRoute(SetupEmail, 'email', { ...IDENTITY });
    cy.get('a[href*="/setup/mfa"], a[href*="/login/password"]').should('exist');
  });

  it('setup/sms renders a Back link', () => {
    mountRoute(SetupSms, 'sms', { ...IDENTITY });
    cy.get('a[href*="/setup/mfa"], a[href*="/login/password"]').should('exist');
  });

  it('setup/passkey renders a Back link', () => {
    mountRoute(SetupPasskey, 'passkey', {
      ...IDENTITY,
      credentialId: 'pk1',
      publicKey: {},
      challengeFailed: false,
    });
    cy.get('a[href*="/setup/mfa"], a[href*="/login/password"]').should('exist');
  });

  it('setup/security-key renders a Back link', () => {
    mountRoute(SetupSecurityKey, 'security-key', {
      ...IDENTITY,
      credentialId: 'u1',
      publicKey: {},
      challengeFailed: false,
    });
    cy.get('a[href*="/setup/mfa"], a[href*="/login/password"]').should('exist');
  });

  it('setup/mfa suppresses the Back link (entry step)', () => {
    mountRoute(SetupMfa, 'mfa', { ...IDENTITY, offerableKeys: ['passkey'] });
    cy.get('a[href*="/login/password"]').should('not.exist');
  });
});
