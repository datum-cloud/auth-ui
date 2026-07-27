// cypress/component/routes/reauth.cy.tsx
//
// UI contract for /reauth's Passkey entry: firing usePasskeyReauthCeremony IN PLACE
// (a Button that lazily loads this route's own ?method=passkey challenge and submits
// the pre-baked Cypress credential) instead of navigating to the two-step
// chooser → "Verify with passkey" flow. Mirrors login/method.cy.tsx.
import Reauth from '@/routes/reauth';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const CHOOSER_VIEW = {
  kind: 'view' as const,
  loginName: 'mia@acme.test',
  methods: ['passkey', 'password'] as const,
  method: null,
  publicKeyCredentialRequestOptions: null,
  returnTo: '/passkeys',
  linkedIdps: [],
};

const capturedPosts: Array<Record<string, unknown>> = [];
// Set by mountReauth({ deferChallenge: true }) — lets a test freeze mid-ceremony
// (phase === 'loading-challenge') to assert the busy/disabled UI deterministically,
// then release it to let the ceremony proceed. Avoids an arbitrary-timeout wait.
let releaseChallenge: (() => void) | null = null;

function withI18n(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

function mountReauth(opts?: { deferChallenge?: boolean }) {
  const router = createMemoryRouter(
    [
      {
        id: 'reauth',
        path: '/reauth',
        element: <Reauth />,
        // Same route serves both the chooser (?method absent) AND the lazily-loaded
        // passkey challenge (?method=passkey) — the ceremony hook fetcher.load()s the
        // latter without navigating away from the former.
        loader: async ({ request }: { request: Request }) => {
          const method = new URL(request.url).searchParams.get('method');
          if (method === 'passkey') {
            if (opts?.deferChallenge) {
              await new Promise<void>((resolve) => {
                releaseChallenge = resolve;
              });
            }
            return {
              csrfToken: 'tok-1',
              view: {
                ...CHOOSER_VIEW,
                method: 'passkey' as const,
                publicKeyCredentialRequestOptions: { publicKey: { challenge: 'x' } },
              },
            };
          }
          return { csrfToken: 'tok-1', view: CHOOSER_VIEW };
        },
        action: async ({ request }: { request: Request }) => {
          capturedPosts.push(Object.fromEntries(await request.formData()));
          // Truthy (not null) — mirrors a real completed action so the ceremony's
          // busy-until-idle effect doesn't stay stuck (see login/index.cy.tsx for the
          // failure this caused once sibling controls started disabling on ceremony.phase).
          return {};
        },
      },
    ],
    {
      initialEntries: ['/reauth?returnTo=/passkeys'],
      hydrationData: {
        loaderData: { reauth: { csrfToken: 'tok-1', view: CHOOSER_VIEW } },
      },
    }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

describe('/reauth — in-place passkey ceremony', () => {
  beforeEach(() => {
    capturedPosts.length = 0;
    releaseChallenge = null;
  });

  it('shows the active identity with a "Not you?" link to /accounts', () => {
    mountReauth();
    cy.contains('Logged in as').should('be.visible');
    cy.contains(CHOOSER_VIEW.loginName).should('be.visible');
    cy.contains('a', 'Not you?').should('have.attr', 'href', '/accounts');
  });

  it('lists Passkey and Password as chooser entries', () => {
    mountReauth();
    cy.contains("Confirm it's you").should('be.visible');
    cy.contains('button', 'Passkey').should('be.visible');
    cy.contains('a', 'Password').should('be.visible');
  });

  it('Passkey fires the ceremony in place and submits the pre-baked credential', () => {
    mountReauth();
    cy.contains('button', 'Passkey').click();
    // Lazy challenge (fetcher.load ?method=passkey) → pre-baked credential → POST.
    cy.wrap(null).should(() => {
      expect(capturedPosts).to.have.length(1);
      expect(capturedPosts[0].factor).to.equal('passkey');
      expect(capturedPosts[0].returnTo).to.equal('/passkeys');
      expect(capturedPosts[0].passkeyCeremony).to.equal('1');
      expect(JSON.parse(String(capturedPosts[0].credential)).id).to.equal('fake-credential-id');
    });
    // No navigation happened — the chooser is still on screen as the fallback.
    // Password stays a plain link (unchanged), so it's matched by its <a> tag.
    cy.contains('a', 'Password').should('be.visible');
  });

  it('shows a busy/loading Passkey button and disables the Password sibling until the challenge resolves', () => {
    mountReauth({ deferChallenge: true });
    cy.contains('button', 'Passkey').click();

    // Mid-flight (phase === 'loading-challenge', frozen by the deferred loader): the
    // Passkey button is disabled (loading=true implies disabled — datum-ui Button) and
    // the Password row is rendered inert (aria-disabled + pointer-events-none), not just
    // visually dimmed — a real click must not navigate it away mid-ceremony.
    cy.contains('button', 'Passkey').should('be.disabled');
    cy.contains('a', 'Password').should('have.attr', 'aria-disabled', 'true');
    cy.contains('a', 'Password').click({ force: true });
    cy.wrap(null).should(() => expect(capturedPosts).to.have.length(0));

    // Release the deferred challenge — the ceremony completes normally.
    cy.then(() => releaseChallenge?.());
    cy.wrap(null).should(() => expect(capturedPosts).to.have.length(1));

    // Busy state clears once the ceremony finishes; Password is interactive again.
    cy.contains('button', 'Passkey').should('not.be.disabled');
    cy.contains('a', 'Password').should('have.attr', 'aria-disabled', 'false');
  });
});

describe('/reauth — idp chooser entry', () => {
  it('renders a button per linked IdP and posts intent=idp-reauth to start the round-trip', () => {
    const capturedIdpPosts: Array<Record<string, unknown>> = [];
    const router = createMemoryRouter(
      [
        {
          id: 'reauth',
          path: '/reauth',
          element: <Reauth />,
          loader: async () => ({
            csrfToken: 'tok-1',
            view: {
              ...CHOOSER_VIEW,
              methods: ['idp', 'password'] as const,
              linkedIdps: [{ idpId: 'idp-google', name: 'Google', type: 'GOOGLE' }],
            },
          }),
          action: async ({ request }: { request: Request }) => {
            const body = Object.fromEntries(await request.formData());
            capturedIdpPosts.push(body);
            return null;
          },
        },
      ],
      {
        initialEntries: ['/reauth?returnTo=/passkeys'],
        hydrationData: {
          loaderData: {
            reauth: {
              csrfToken: 'tok-1',
              view: {
                ...CHOOSER_VIEW,
                methods: ['idp', 'password'],
                linkedIdps: [{ idpId: 'idp-google', name: 'Google', type: 'GOOGLE' }],
              },
            },
          },
        },
      }
    );
    mount(withI18n(<RouterProvider router={router} />));

    cy.contains('button', 'Google').click();
    cy.wrap(null).should(() => {
      expect(capturedIdpPosts).to.have.length(1);
      expect(capturedIdpPosts[0].intent).to.equal('idp-reauth');
      expect(capturedIdpPosts[0].idpId).to.equal('idp-google');
      expect(capturedIdpPosts[0].returnTo).to.equal('/passkeys');
    });
  });
});
