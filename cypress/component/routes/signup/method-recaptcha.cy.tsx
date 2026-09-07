// cypress/component/routes/signup/method-recaptcha.cy.tsx
import SignupMethod from '@/routes/signup/method';
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

const VIEW = { showEmailLink: false, showPasskey: true, showPassword: false };

function loaderData(overrides: Record<string, unknown> = {}) {
  return {
    csrfToken: 'csrf-token-xyz',
    loginName: 'john.doe@example.com',
    firstName: 'John',
    lastName: 'Doe',
    organization: undefined,
    requestId: undefined,
    deviceTrackingToken: undefined,
    maxmindAccountId: '',
    recaptchaSiteKey: '',
    view: VIEW,
    ...overrides,
  };
}

function mountMethod(data: unknown, onSubmitFormData?: (form: FormData) => void) {
  const router = createMemoryRouter(
    [
      {
        id: 'signup-method',
        path: '/signup/method',
        element: <SignupMethod />,
        // Captures the REAL submitted FormData — see signup-render.cy.tsx's mountSignup for why
        // this beats asserting on post-navigation DOM state.
        action: async ({ request }) => {
          onSubmitFormData?.(await request.formData());
          return null;
        },
        loader: () => data,
      },
    ],
    {
      initialEntries: ['/signup/method'],
      hydrationData: { loaderData: { 'signup-method': data } },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('signup/method — the reCAPTCHA token actually reaches the submitted request', () => {
  const SITE_KEY = 'test-site-key';

  // Prevents an actual network call to https://www.google.com/recaptcha/api.js (the loader
  // effect injects this script whenever recaptchaSiteKey is configured) — avoids CI flakiness
  // and stops a real script load from racing in and overwriting the window.grecaptcha stub.
  function stubRecaptchaScriptRequest() {
    cy.intercept('GET', '**/recaptcha/api.js*', { statusCode: 200, body: '' }).as(
      'recaptchaScript'
    );
  }

  it('mints under action "signup" on a click and the minted token is what actually gets sent', () => {
    stubRecaptchaScriptRequest();
    const submitted: FormData[] = [];
    const execute = cy.stub().resolves('tok-method-xyz');
    mountMethod(loaderData({ recaptchaSiteKey: SITE_KEY }), (form) => submitted.push(form));
    cy.window().then((win) => {
      win.grecaptcha = { execute };
    });
    cy.contains('john.doe@example.com', { timeout: 6000 });
    cy.contains('button', 'Use a passkey').click();
    cy.wrap(submitted, { timeout: 6000 }).should('have.length', 1);
    cy.then(() => {
      expect(submitted[0].get('intent')).to.equal('passkey');
      expect(
        submitted[0].get('recaptchaToken'),
        'non-empty — the exact field a click-only or button-only interceptor could leave empty'
      ).to.equal('tok-method-xyz');
      expect(execute.callCount).to.equal(1);
      expect(execute.getCall(0).args).to.deep.equal([SITE_KEY, { action: 'signup' }]);
    });
  });

  it('a non-click submit trigger still mints under "signup" and carries a non-empty token', () => {
    stubRecaptchaScriptRequest();
    const submitted: FormData[] = [];
    const execute = cy.stub().resolves('tok-enter-signup');
    mountMethod(loaderData({ recaptchaSiteKey: SITE_KEY }), (form) => submitted.push(form));
    cy.window().then((win) => {
      win.grecaptcha = { execute };
    });
    cy.contains('john.doe@example.com', { timeout: 6000 });
    cy.get('form').submit();
    cy.wrap(submitted, { timeout: 6000 }).should('have.length', 1);
    cy.then(() => {
      expect(submitted[0].get('intent')).to.equal('passkey');
      expect(
        submitted[0].get('recaptchaToken'),
        'non-empty even though no button was ever clicked'
      ).to.equal('tok-enter-signup');
      expect(execute.callCount).to.equal(1);
      expect(execute.getCall(0).args).to.deep.equal([SITE_KEY, { action: 'signup' }]);
    });
  });

  it('submits without stalling when grecaptcha.execute() rejects — a missing token is a server-handled outcome, not a client failure', () => {
    stubRecaptchaScriptRequest();
    const submitted: FormData[] = [];
    const execute = cy.stub().rejects(new Error('widget failed'));
    mountMethod(loaderData({ recaptchaSiteKey: SITE_KEY }), (form) => submitted.push(form));
    cy.window().then((win) => {
      win.grecaptcha = { execute };
    });
    cy.contains('john.doe@example.com', { timeout: 6000 });
    cy.contains('button', 'Use a passkey').click();
    cy.wrap(submitted, { timeout: 6000 }).should('have.length', 1);
    cy.then(() => {
      expect(submitted[0].get('recaptchaToken')).to.equal('');
      expect(submitted[0].get('intent')).to.equal('passkey');
    });
  });

  it('stays entirely inert when unconfigured: no field is rendered, grecaptcha is never touched, and no field is sent', () => {
    const submitted: FormData[] = [];
    const execute = cy.stub();
    mountMethod(loaderData(), (form) => submitted.push(form));
    cy.window().then((win) => {
      win.grecaptcha = { execute };
    });
    cy.contains('john.doe@example.com', { timeout: 6000 });
    // "Unset config ⇒ feature entirely off" covers the field itself, not just the script and
    // the verification: an unconfigured deployment must not ship this input at all.
    cy.get('input[name="recaptchaToken"]').should('not.exist');
    cy.contains('button', 'Use a passkey').click();
    cy.wrap(submitted, { timeout: 6000 }).should('have.length', 1);
    cy.then(() => {
      expect(
        submitted[0].get('recaptchaToken'),
        'unconfigured never sends the field at all — absent, not merely empty'
      ).to.equal(null);
      expect(execute.callCount, 'grecaptcha.execute is never called when unconfigured').to.equal(0);
    });
  });

  it('renders the recaptchaToken field when configured', () => {
    stubRecaptchaScriptRequest();
    mountMethod(loaderData({ recaptchaSiteKey: SITE_KEY }));
    cy.contains('john.doe@example.com', { timeout: 6000 });
    cy.get('input[name="recaptchaToken"]').should('exist');
  });
});
