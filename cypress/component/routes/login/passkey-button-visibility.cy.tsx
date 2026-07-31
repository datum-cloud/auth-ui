// cypress/component/routes/login/passkey-button-visibility.cy.tsx
//
// Review finding (2026-07-30): the Passkey button used to render ONLY when a
// loginName was already known (`view.showPasskeyPrompt && loginName`), which hid it on
// every ordinary cold /login visit. Ruling: keep the in-place ceremony (no href, no
// identity in the DOM), render the button unconditionally, and bind it to whatever
// identity IS resolvable (URL identifier, else the loader's usernameless hint). With NO
// resolvable identity a click must route into the identifier field instead of firing a
// ceremony Zitadel would refuse (it cannot mint a challenge for an unbound user).
// Mirrors index.cy.tsx's mount harness (same router stub, loader data shape, and
// /login/passkey action capture convention).
import Login from '@/routes/login/index';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const LOGIN_CONTEXT = { loginName: '', requestId: undefined, organization: undefined };

// Settings shaped so both the IdP/password chooser AND the Passkey prompt render —
// the baseline the visibility/identity-binding behavior is exercised against.
const BASE_LOADER_DATA = {
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
  // Known loginName threads through useLoginContext (URL identifier — e.g. ?loginName=).
  loginName?: string;
  // Loader-resolved usernameless hint (Task 7's conditionalPasskey field). Null/undefined
  // mirrors a cold visit with no hint.
  conditionalPasskey?: { loginName: string; publicKeyCredentialRequestOptions: unknown } | null;
  // Loader-armed identity discovery (fresh browser, no hint). Null/undefined mirrors a
  // loader-SUPPRESSED visit (?add=1 / live session) where the button must fall back.
  identityDiscovery?: { publicKeyCredentialRequestOptions: unknown } | null;
}) {
  const loginContext = { ...LOGIN_CONTEXT, loginName: opts?.loginName ?? LOGIN_CONTEXT.loginName };
  const indexLoaderData = {
    ...BASE_LOADER_DATA,
    conditionalPasskey: opts?.conditionalPasskey ?? null,
    identityDiscovery: opts?.identityDiscovery ?? null,
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
            loader: async () => indexLoaderData,
            action: async () => null,
          },
          // Stub /login/passkey — same route the shared ceremony hook lazily loads
          // (challenge) then posts to (credential). Mirrors index.cy.tsx's convention:
          // no navigation assertions, just the captured POST.
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
            action: async ({ request }: { request: Request }) => {
              capturedPosts.push(Object.fromEntries(await request.formData()));
              return {};
            },
          },
        ],
      },
    ],
    {
      initialEntries: ['/login'],
      hydrationData: {
        loaderData: { login: loginContext, index: indexLoaderData },
      },
    }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('/login Passkey button — visibility and identity binding', () => {
  beforeEach(() => {
    capturedPosts.length = 0;
  });

  it('renders with no loginName and no hint (cold visit)', () => {
    mountLogin();
    cy.contains('button', /passkey/i)
      .should('exist')
      .and('not.be.disabled');
  });

  it('cold click with discovery UNARMED (loader-suppressed) falls back to the identifier field', () => {
    // identityDiscovery null = the loader suppressed arming (?add=1 / live session).
    // beginDiscovery has no options to run over → the identifier step is the fallback
    // (spec, open decision §3 as built).
    mountLogin();
    cy.contains('button', /passkey/i).click();
    cy.get('input[name="loginName"]').should('be.visible');
    cy.then(() => expect(capturedPosts).to.have.length(0));
  });

  it('cold click with discovery ARMED fires the modal discovery flow, not the email field', () => {
    cy.intercept('POST', '**/id/login/passkey-discover', {
      statusCode: 200,
      body: {
        loginName: 'mia@acme.test',
        csrfToken: 'tok-d',
        publicKeyCredentialRequestOptions: { publicKey: { challenge: 'zitadel-x' } },
      },
    }).as('discover');
    mountLogin({
      identityDiscovery: {
        publicKeyCredentialRequestOptions: { publicKey: { challenge: 'identity-x' } },
      },
    });
    cy.contains('button', /passkey/i).click();
    cy.wait('@discover');
    // The discover response's resolved identity drives the verify POST.
    cy.then(() => {
      expect(capturedPosts).to.have.length(1);
      expect(capturedPosts[0].loginName).to.equal('mia@acme.test');
      expect(capturedPosts[0].csrf).to.equal('tok-d');
    });
  });

  it('hinted click fires the ceremony bound to the hinted loginName', () => {
    mountLogin({
      conditionalPasskey: {
        loginName: 'mia@acme.test',
        publicKeyCredentialRequestOptions: { publicKey: { challenge: 'x' } },
      },
    });
    cy.contains('button', /passkey/i).click();
    cy.then(() => {
      expect(capturedPosts).to.have.length(1);
      expect(capturedPosts[0].loginName).to.equal('mia@acme.test');
    });
  });

  it('renders identically hinted vs unhinted — no name, no badge, no extra affordance', () => {
    mountLogin({
      conditionalPasskey: {
        loginName: 'mia@acme.test',
        publicKeyCredentialRequestOptions: { publicKey: { challenge: 'x' } },
      },
    });
    cy.contains('mia@acme.test').should('not.exist');
    // Scope to <main> (SplitLayout's form panel) — the stable container for everything
    // this component renders, excluding the surrounding chrome and the Cypress runner's
    // own bootstrap script tags a `body`-wide `.text()` read would otherwise pick up.
    cy.get('main').then(($hinted) => {
      const hintedText = $hinted.text();
      mountLogin();
      cy.contains('mia@acme.test').should('not.exist');
      cy.get('main').should(($cold) => {
        expect($cold.text()).to.equal(hintedText);
      });
    });
  });
});
