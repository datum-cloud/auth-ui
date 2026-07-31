// cypress/component/routes/login/index.cy.tsx
//
// UI contract for /login (A-P10): the sole-passkey action-data variant fires the
// shared ceremony INLINE ("Signing in as <email>." + auto-fire via beginWith), with
// a manual "Continue with passkey" fallback (begin(), a FRESH challenge) and a
// "Not you?" dismissal back to the ordinary identifier form. Mirrors method.cy.tsx's
// stub /login/passkey route + capturedPosts convention (Task 2).
import Login from '@/routes/login/index';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const LOGIN_CONTEXT = { loginName: '', requestId: undefined, organization: undefined };

// Settings shaped so the ordinary identifier form (the "Continue with email" button) renders by
// default — the baseline the inline ceremony state must replace/restore around.
const INDEX_LOADER_DATA = {
  csrfToken: 'tok-0',
  idps: [],
  settings: {
    allowPassword: true,
    allowRegister: false,
    allowExternalIdp: false,
    passkeysType: 'allowed',
    forceMfa: false,
    disableLoginWithEmail: false,
    disableLoginWithPhone: false,
  },
  branding: null,
  emailDeliveryEnabled: false,
  notice: undefined,
  lastUsedLogin: undefined,
};

const capturedPosts: Array<Record<string, unknown>> = [];

function withI18n(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

function mountLogin(opts?: {
  actionData?: unknown;
  // Known loginName gates the Passkey SHORTCUT visible (view.showPasskeyPrompt && loginName).
  loginName?: string;
  // Overrides the /login (index) route's own action — used to simulate a REAL identifier
  // resubmit that resolves to a fresh sole-passkey challenge (Finding 2 coverage).
  indexAction?: (args: { request: Request }) => unknown | Promise<unknown>;
  // Overrides the /login/passkey stub's action — used to simulate a ceremony failure
  // (Finding 1 coverage). Defaults to capturing the POST into capturedPosts.
  passkeyAction?: (args: { request: Request }) => unknown | Promise<unknown>;
  // Org-policy overrides — used to cover configurations where password is disabled.
  settings?: Partial<(typeof INDEX_LOADER_DATA)['settings']>;
  emailDeliveryEnabled?: boolean;
}) {
  const loginContext = { ...LOGIN_CONTEXT, loginName: opts?.loginName ?? LOGIN_CONTEXT.loginName };
  // Must feed BOTH the loader and the router's hydrationData below — with hydrationData
  // present the loaders do not run on initial render, so patching only the loader is a no-op.
  const indexData = {
    ...INDEX_LOADER_DATA,
    settings: { ...INDEX_LOADER_DATA.settings, ...opts?.settings },
    emailDeliveryEnabled: opts?.emailDeliveryEnabled ?? INDEX_LOADER_DATA.emailDeliveryEnabled,
  };
  const router = createMemoryRouter(
    [
      {
        id: 'login',
        path: '/login',
        loader: () => loginContext,
        children: [
          {
            id: 'index',
            index: true,
            element: <Login />,
            loader: async () => indexData,
            action: opts?.indexAction ?? (async () => null),
          },
          // Stub /login/passkey — same route the shared ceremony hook lazily loads
          // (challenge) then posts to (credential). Mirrors method.cy.tsx's convention:
          // no navigation assertions, just the captured POST (or a stubbed failure datum).
          {
            id: 'passkey',
            path: 'passkey',
            loader: async () => ({
              csrfToken: 'tok-1',
              loginName: opts?.loginName ?? 'solo@acme.test',
              requestId: undefined,
              organization: undefined,
              publicKeyCredentialRequestOptions: { publicKey: { challenge: 'x' } },
            }),
            action:
              opts?.passkeyAction ??
              (async ({ request }: { request: Request }) => {
                capturedPosts.push(Object.fromEntries(await request.formData()));
                // Truthy (not null) — mirrors a real completed action (redirect navigates away;
                // a rejection returns a truthy {error} object). A falsy return would leave the
                // ceremony's busy-until-idle effect (submitFetcher.data truthiness) stuck forever,
                // which is never reachable in production but would wrongly keep sibling controls
                // disabled here since redirect-following is RR-internal and not under test.
                return {};
              }),
          },
        ],
      },
    ],
    {
      initialEntries: ['/login'],
      hydrationData: {
        loaderData: { login: loginContext, index: indexData },
        ...(opts?.actionData !== undefined ? { actionData: { index: opts.actionData } } : {}),
      },
    }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('/login — sole-passkey inline ceremony', () => {
  beforeEach(() => {
    capturedPosts.length = 0;
  });

  it('sole-passkey action data swaps to the inline ceremony state and auto-fires', () => {
    mountLogin({
      actionData: {
        passkeyInline: {
          loginName: 'solo@acme.test',
          csrfToken: 'tok-1',
          publicKeyCredentialRequestOptions: { publicKey: { challenge: 'x' } },
        },
      },
    });
    cy.contains('Signing in as').should('be.visible');
    cy.contains('solo@acme.test').should('be.visible');
    cy.contains('Not you?').should('be.visible');
    // Auto-fire: the pre-baked credential reaches the stub action without a click.
    cy.wrap(null).should(() => {
      expect(capturedPosts).to.have.length(1);
      expect(capturedPosts[0].loginName).to.equal('solo@acme.test');
    });
    // Identifier form is gone while the ceremony state shows.
    cy.contains('button', 'Continue with email').should('not.exist');
  });

  // REGRESSION: with allowPassword=false the identifier form used to be hidden entirely,
  // while signInUnavailable stayed false (suppressed by showPasskeyPrompt) — so a fresh
  // visitor at a passkey-only org got an EMPTY card: no sign-in path and no error.
  // Passkey needs a known user (zitadel/zitadel#8899), so the identifier IS the entry point.
  it('a passkey-only org still offers the identifier form, not an empty card', () => {
    mountLogin({
      settings: { allowPassword: false, passkeysType: 'allowed' },
      emailDeliveryEnabled: false,
    });
    cy.contains('button', 'Continue with email').should('be.visible');
    cy.contains('Sign-in is currently unavailable').should('not.exist');
  });

  // When email-link is the ONLY path, "Continue" would hand off to decideAfterIdentifier
  // and resolve to NO_SUPPORTED_METHOD — so it must not render. The email-link submit
  // takes over as the form's primary (and only) action.
  it('an email-link-only org shows the form without a dead-end Continue button', () => {
    mountLogin({
      settings: { allowPassword: false, passkeysType: 'not_allowed' },
      emailDeliveryEnabled: true,
    });
    cy.contains('button', 'Continue with email').should('be.visible').click();
    cy.contains('button', 'Email me a sign-in link').should('be.visible');
    // Exactly one submit action — no "Continue" alongside it.
    cy.get('form button[type="submit"]').should('have.length', 1);
    cy.contains('form button', 'Continue').should('not.exist');
    // The intent rides on a hidden field, so implicit submission still means email-link.
    cy.get('form input[name="intent"]').should('have.value', 'email-link');
  });

  it('inline state offers the manual button and Not you? returns to the identifier form', () => {
    mountLogin({
      actionData: {
        passkeyInline: {
          loginName: 'solo@acme.test',
          csrfToken: 'tok-1',
          publicKeyCredentialRequestOptions: { publicKey: { challenge: 'x' } },
        },
      },
    });
    cy.contains('button', 'Continue with passkey').should('be.visible');
    cy.contains('Not you?').click();
    cy.contains('button', 'Continue with email').should('be.visible');
  });

  // Finding 1: the gated Passkey SHORTCUT drives the same `ceremony` as the inline
  // state but never sets passkeyInline — a failure there must still surface visibly.
  it('the gated Passkey shortcut surfaces a ceremony failure through the shared error region', () => {
    mountLogin({
      loginName: 'solo@acme.test',
      // The /login/passkey ACTION rejects the (fake, Cypress-marshalled) credential —
      // this is the server-side rejection path (ceremony.actionData), not a browser-side
      // ceremony throw (ceremony.reason); the shared region must render either.
      passkeyAction: async () => ({ error: 'INVALID_CREDENTIALS' }),
    });
    cy.contains('button', 'Passkey').should('not.be.disabled').click();
    cy.contains('Incorrect credentials. Please try again.').should('be.visible');
    // The shortcut re-enables once the ceremony drops back to idle (not stuck busy).
    cy.contains('button', 'Passkey').should('not.be.disabled');
  });

  // Finding 2: dismissal is keyed to the SPECIFIC challenge, not a component-lifetime
  // boolean — a later, unrelated sole-passkey resolution must still auto-fire. Driven via
  // a REAL identifier resubmit (not a remount, which would reset all component state and
  // prove nothing about the dismiss→re-arm transition on the same mounted instance).
  it('a fresh sole-passkey challenge after "Not you?" auto-fires again (re-arm, not stuck)', () => {
    const CHALLENGE_B = { publicKey: { challenge: 'chal-b' } };
    mountLogin({
      loginName: 'solo@acme.test',
      actionData: {
        passkeyInline: {
          loginName: 'solo@acme.test',
          csrfToken: 'tok-1',
          publicKeyCredentialRequestOptions: { publicKey: { challenge: 'chal-a' } },
        },
      },
      // Simulates the /login action resolving a DIFFERENT identifier to a fresh
      // sole-passkey challenge — a real resubmit, not the same dismissed challenge.
      indexAction: async () => ({
        passkeyInline: {
          loginName: 'other@acme.test',
          csrfToken: 'tok-2',
          publicKeyCredentialRequestOptions: CHALLENGE_B,
        },
      }),
    });

    // Auto-fire #1 (challenge A) reaches the stub /login/passkey action.
    cy.wrap(null).should(() => expect(capturedPosts).to.have.length(1));

    cy.contains('Not you?').click();
    cy.contains('button', 'Continue with email').should('be.visible').click();
    cy.contains('button', 'Continue').click();

    // The fresh challenge (different identity, different publicKeyCredentialRequestOptions
    // object) shows the inline state again and auto-fires a SECOND time.
    cy.contains('other@acme.test').should('be.visible');
    cy.wrap(null).should(() => {
      expect(capturedPosts).to.have.length(2);
      expect(capturedPosts[1].loginName).to.equal('other@acme.test');
    });
  });
});
