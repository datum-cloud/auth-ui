// cypress/component/routes/login/index.cy.tsx
//
// UI contract for /login (post-A-P10-reversal, Task 12 — product ruling): the chooser
// renders unconditionally. There is no identity-bound inline passkey ceremony state on
// this route anymore — a sole-passkey identifier now REDIRECTS to /login/passkey (see
// the node-bound action test below) instead of the action returning inline challenge
// data. The gated Passkey SHORTCUT (Task 11) still drives the shared ceremony in place
// on this page, and its own failure surface is still covered here. Mirrors
// method.cy.tsx's stub /login/passkey route + capturedPosts convention (Task 2).
import { callService } from '../../../support/node/call-service';
import Login from '@/routes/login/index';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const LOGIN_CONTEXT = { loginName: '', requestId: undefined, organization: undefined };

// Settings shaped so the ordinary identifier form (the "Email" button) renders by
// default — the baseline the chooser must always render, regardless of actionData.
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
  // Overrides the /login/passkey stub's action — used to simulate a ceremony failure
  // (Finding 1 coverage). Defaults to capturing the POST into capturedPosts.
  passkeyAction?: (args: { request: Request }) => unknown | Promise<unknown>;
  // Org-policy overrides — cover configurations where password is disabled (#107's
  // showIdentifierForm/showContinue view logic, grafted from main's spec version).
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
            action: async () => null,
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

describe('/login — chooser (no inline ceremony)', () => {
  beforeEach(() => {
    capturedPosts.length = 0;
  });

  it('never renders an identity-bound inline block — the chooser always stays on screen', () => {
    // Mount with the action having returned what USED to trigger the inline block.
    // The chooser must render regardless; no identity, no "Not you?", no inline CTA.
    mountLogin({
      actionData: {
        passkeyInline: {
          loginName: 'solo@acme.test',
          csrfToken: 'tok-1',
          publicKeyCredentialRequestOptions: { publicKey: { challenge: 'x' } },
        },
      },
    });
    cy.contains(/signing in as/i).should('not.exist');
    cy.contains(/not you\?/i).should('not.exist');
    cy.contains('button', /continue with passkey/i).should('not.exist');
    cy.get('input[name="loginName"], button').should('exist'); // chooser is intact
  });

  // Finding 1: the gated Passkey SHORTCUT drives the shared `ceremony` in place on this
  // page — a failure there must still surface visibly.
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
});

describe('/login action — sole-passkey identifier', () => {
  it('a sole-passkey identifier now REDIRECTS to /login/passkey instead of returning inline data', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: 'solo@acme.test' }, // u21 — the seeded passkey-ONLY fixture
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.contain('/login/passkey');
      expect(v.response?.location ?? '').to.contain('loginName=');
    });
  });
});

// ── #107 view logic (grafted from main's spec version at the merge) ──────────────
// The inline-ceremony tests main carried were dropped — the merged runtime keeps the
// Task-12 product ruling (sole-passkey REDIRECTS to /login/passkey, asserted above) —
// but these two cover showIdentifierForm/showContinue, which survive unchanged.
describe('/login — identifier-form view logic (#107)', () => {
  // REGRESSION: with allowPassword=false the identifier form used to be hidden entirely,
  // while signInUnavailable stayed false (suppressed by showPasskeyPrompt) — so a fresh
  // visitor at a passkey-only org got an EMPTY card: no sign-in path and no error.
  // Passkey needs a known user (zitadel/zitadel#8899), so the identifier IS the entry point.
  it('a passkey-only org still offers the identifier form, not an empty card', () => {
    mountLogin({
      settings: { allowPassword: false, passkeysType: 'allowed' },
      emailDeliveryEnabled: false,
    });
    cy.contains('button', 'Email').should('be.visible');
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
    cy.contains('button', 'Email').should('be.visible').click();
    cy.contains('button', 'Email me a sign-in link').should('be.visible');
    // Exactly one submit action — no "Continue" alongside it.
    cy.get('form button[type="submit"]').should('have.length', 1);
    cy.contains('form button', 'Continue').should('not.exist');
    // The intent rides on a hidden field, so implicit submission still means email-link.
    cy.get('form input[name="intent"]').should('have.value', 'email-link');
  });
});
