// cypress/component/routes/login/method.cy.tsx
//
// UI contract for /login/method (A-P10): identity header ("Signing in as <loginName>" /
// "Not you?") and the Passkey entry firing usePasskeyLoginCeremony IN PLACE (a Button
// that lazily loads the /login/passkey challenge and submits the pre-baked Cypress
// credential) instead of navigating there. The other method entries stay plain links.
import LoginMethod from '@/routes/login/method';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const LOGIN_CONTEXT = {
  loginName: 'mia@acme.test',
  requestId: undefined,
  organization: undefined,
};
const METHOD_LOADER_DATA = {
  methods: ['passkey', 'password'],
  branding: null,
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

function mountMethod() {
  const router = createMemoryRouter(
    [
      {
        id: 'login',
        path: '/login',
        loader: () => LOGIN_CONTEXT,
        children: [
          {
            id: 'method',
            path: 'method',
            element: <LoginMethod />,
            loader: async () => METHOD_LOADER_DATA,
          },
          // Stub /login/passkey — same route the shared ceremony hook lazily loads
          // (challenge) then posts to (credential). Mirrors passkeys-ui.cy.tsx's
          // render-only convention: no navigation assertions, just the captured POST.
          {
            id: 'passkey',
            path: 'passkey',
            loader: async () => ({
              csrfToken: 'tok-1',
              loginName: 'mia@acme.test',
              requestId: undefined,
              organization: undefined,
              publicKeyCredentialRequestOptions: { publicKey: { challenge: 'x' } },
            }),
            action: async ({ request }: { request: Request }) => {
              capturedPosts.push(Object.fromEntries(await request.formData()));
              return null; // surface stays; redirect-following is RR-internal, not under test
            },
          },
        ],
      },
    ],
    {
      initialEntries: ['/login/method?loginName=mia%40acme.test'],
      hydrationData: {
        loaderData: { login: LOGIN_CONTEXT, method: METHOD_LOADER_DATA },
      },
    }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('/login/method — identity header + in-place passkey ceremony', () => {
  beforeEach(() => {
    capturedPosts.length = 0;
  });

  it('shows the identity header with a Not you? action back to /login', () => {
    mountMethod();
    cy.contains('Signing in as').should('be.visible');
    cy.contains('mia@acme.test').should('be.visible');
    cy.contains('a', 'Not you?')
      .should('have.attr', 'href')
      .and('match', /\/login(\?|$)/)
      .and('not.contain', 'loginName');
  });

  it('Passkey fires the ceremony in place and submits the pre-baked credential', () => {
    mountMethod();
    cy.contains('button', 'Passkey').click();
    // Lazy challenge → pre-baked credential → POST to the stub action.
    cy.wrap(null).should(() => {
      expect(capturedPosts).to.have.length(1);
      expect(capturedPosts[0].loginName).to.equal('mia@acme.test');
      expect(JSON.parse(String(capturedPosts[0].credential)).id).to.equal('fake-credential-id');
    });
    // No navigation happened — the chooser is still on screen as the fallback.
    // Password stays a plain link (unchanged), so it's matched by its <a> tag.
    cy.contains('a', 'Password').should('be.visible');
  });
});
