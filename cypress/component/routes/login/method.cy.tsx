// cypress/component/routes/login/method.cy.tsx
//
// UI contract for /login/method (A-P10): identity header ("Signing in as <loginName>" /
// "Not you?") and the Passkey entry firing usePasskeyLoginCeremony IN PLACE — a real <a> to
// /login/passkey whose click JS intercepts to lazily load the challenge and submit the pre-baked
// Cypress credential, so an unhydrated visitor simply follows the href instead. Every method
// entry is a link; only the IdP rows are submit buttons (starting an intent needs an action).
import LoginMethod, { shouldRevalidate } from '@/routes/login/method';
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
  idps: [],
  csrfToken: 'tok-1',
};

const capturedPosts: Array<Record<string, unknown>> = [];
// Every challenge fetch the ceremony makes. Used as the sync point for the "did the
// auto-begun attempt actually run?" assertions below — a ceremony that fails at the
// challenge produces no POST, so capturedPosts cannot serve as the observable there.
const challengeLoads: string[] = [];

function withI18n(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

// Optional overrides let sole-passkey tests exercise a different `methods` array and
// `loginName` without duplicating the router wiring — same override-and-spread idiom
// passkey-button-visibility.cy.tsx's mountLogin() already uses for this same route family.
function mountMethod(opts?: {
  methods?: Array<'passkey' | 'password' | 'otp_email' | 'idp'>;
  loginName?: string;
  // A null challenge is the deterministic failure seam: the hook treats a missing
  // publicKeyCredentialRequestOptions as a non-fatal mint failure and sets reason='unknown'
  // WITHOUT touching navigator.credentials, so a spec can exercise the failure copy without
  // depending on the browser's real WebAuthn behavior.
  challenge?: unknown;
}) {
  const loginContext = { ...LOGIN_CONTEXT, loginName: opts?.loginName ?? LOGIN_CONTEXT.loginName };
  const methodLoaderData = {
    ...METHOD_LOADER_DATA,
    methods: opts?.methods ?? METHOD_LOADER_DATA.methods,
  };
  const router = createMemoryRouter(
    [
      {
        id: 'login',
        path: '/login',
        loader: () => loginContext,
        children: [
          {
            id: 'method',
            path: 'method',
            element: <LoginMethod />,
            loader: async () => methodLoaderData,
          },
          // Stub /login/passkey — same route the shared ceremony hook lazily loads
          // (challenge) then posts to (credential). Mirrors passkeys-ui.cy.tsx's
          // render-only convention: no navigation assertions, just the captured POST.
          {
            id: 'passkey',
            path: 'passkey',
            loader: async () => {
              challengeLoads.push(loginContext.loginName);
              return {
                csrfToken: 'tok-1',
                loginName: loginContext.loginName,
                requestId: undefined,
                organization: undefined,
                publicKeyCredentialRequestOptions:
                  opts && 'challenge' in opts ? opts.challenge : { publicKey: { challenge: 'x' } },
              };
            },
            action: async ({ request }: { request: Request }) => {
              capturedPosts.push(Object.fromEntries(await request.formData()));
              // Truthy (not null) — mirrors a real completed action so the ceremony's
              // busy-until-idle effect doesn't stay stuck (see index.cy.tsx for the failure
              // this caused once sibling controls started disabling on ceremony.phase).
              return {};
            },
          },
        ],
      },
    ],
    {
      initialEntries: [`/login/method?loginName=${encodeURIComponent(loginContext.loginName)}`],
      hydrationData: {
        loaderData: { login: loginContext, method: methodLoaderData },
      },
    }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

// Same observable the neighbouring "Passkey fires the ceremony in place" test above uses to
// prove a ceremony ran: the captured POST to the /login/passkey stub action. Asserting on
// this (not on ceremony.phase / button-disabled) avoids racing the Cypress fake-credential
// seam, which resolves the ceremony without ever showing a real dialog.
function expectCeremonyStarted(times: number) {
  cy.wrap(null).should(() => {
    expect(capturedPosts).to.have.length(times);
  });
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

  it('Passkey is a REAL link to /login/passkey, so it works without hydration', () => {
    // It was a <Button htmlType="button"> — inert until React hydrates. For a sole-passkey
    // account that button is the ONLY control on the page, so an unhydrated visitor had no way
    // forward at all (before the chooser existed they were redirected to /login/passkey, which
    // is exactly where this href points). Same convention as the Password entry.
    mountMethod();
    cy.contains('a', 'Passkey')
      .should('have.attr', 'href')
      .and('contain', '/login/passkey')
      .and('contain', 'loginName=mia%40acme.test');
  });

  it('Passkey fires the ceremony in place and submits the pre-baked credential', () => {
    mountMethod();
    cy.contains('a', 'Passkey').click();
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

  it("posts intent=idp + idpId to this route's own action instead of navigating to /sso", () => {
    const methodData = {
      methods: ['idp', 'password'],
      branding: null,
      idps: [{ id: 'idp-google', name: 'Google', type: 'GOOGLE' }],
      csrfToken: 'tok-1',
    };
    const capturedIdpPosts: Array<Record<string, unknown>> = [];
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
              loader: async () => methodData,
              action: async ({ request }: { request: Request }) => {
                capturedIdpPosts.push(Object.fromEntries(await request.formData()));
                return null;
              },
            },
          ],
        },
      ],
      {
        initialEntries: ['/login/method?loginName=mia%40acme.test'],
        hydrationData: {
          loaderData: { login: LOGIN_CONTEXT, method: methodData },
        },
      }
    );
    mount(withI18n(<RouterProvider router={router} />));

    // Named after the actual provider ("Google") — IdpButtonList's own copy, matching
    // /login's own idp buttons — rendered as a submit button (not an <a> to /sso), since
    // starting sign-in is a provider-side call that has to happen in an action.
    cy.contains('button', 'Google').click();
    cy.wrap(null).should(() => {
      expect(capturedIdpPosts).to.have.length(1);
      expect(capturedIdpPosts[0].intent).to.equal('idp');
      expect(capturedIdpPosts[0].idpId).to.equal('idp-google');
    });
    cy.contains('a', 'Password').should('be.visible');
  });
});

describe('/login/method — sole passkey', () => {
  beforeEach(() => {
    capturedPosts.length = 0;
    challengeLoads.length = 0;
  });

  it('auto-begins the ceremony on load when passkey is the only method', () => {
    // A sole passkey needs no chooser: the user already stated intent at the
    // identifier step, so the ceremony starts on arrival.
    mountMethod({ methods: ['passkey'], loginName: 'passkey-user@acme.test' });
    expectCeremonyStarted(1);
  });

  it('does NOT auto-begin when a second method exists', () => {
    // Two methods is a real choice — the chooser must stay quiet until the user picks.
    mountMethod({ methods: ['passkey', 'password'], loginName: 'mia@acme.test' });
    expectCeremonyStarted(0);
  });

  it('auto-begins once on load, then still allows a manual retry once idle again', () => {
    // One-shot: the ref latch guards the EFFECT, not the button. Mounting fires exactly
    // one auto-begun ceremony despite the several re-renders its own phase transitions
    // (loading-challenge → ceremony → submitting → idle) cause along the way — if the
    // latch didn't survive those re-renders, the unguarded effect would re-fire begin()
    // on each one and this test would already see far more than the final count below.
    // Once settled, the button must NOT be stuck busy forever, so a real click after it
    // is a legitimate manual retry — one MORE ceremony, not a re-prompt loop.
    mountMethod({ methods: ['passkey'], loginName: 'passkey-user@acme.test' });
    cy.contains('a', /passkey/i).click(); // re-render, then an explicit retry once idle
    expectCeremonyStarted(2);
  });

  // The auto-begun attempt runs with NO transient user activation — nothing was clicked, the
  // screen merely loaded. WebKit rejects navigator.credentials.get() in that state with
  // NotAllowedError, which classifies as 'not-allowed' and whose copy accuses the user of
  // cancelling. Both halves are pinned here: silent for the attempt nobody asked for, loud for
  // the one they did.
  it('says nothing when the AUTO-BEGUN ceremony fails — the user cancelled nothing', () => {
    mountMethod({ methods: ['passkey'], loginName: 'passkey-user@acme.test', challenge: null });
    // Sync point: the ceremony really did run and reach its (failing) challenge.
    cy.wrap(null).should(() => {
      expect(challengeLoads).to.have.length(1);
    });
    cy.contains('The passkey verification failed').should('not.exist');
    // …and the way forward is still on screen.
    cy.contains('a', /passkey/i).should('be.visible');
  });

  it('DOES report the failure once the user starts the ceremony themselves', () => {
    mountMethod({ methods: ['passkey'], loginName: 'passkey-user@acme.test', challenge: null });
    cy.wrap(null).should(() => {
      expect(challengeLoads).to.have.length(1); // the silent auto attempt
    });
    cy.contains('a', /passkey/i).click(); // now it is the user's own attempt
    cy.contains('The passkey verification failed').should('be.visible');
  });
});

describe('/login/method — shouldRevalidate', () => {
  // This loader MINTS ceremony state (a Zitadel IdP intent for a sole-linked-IdP account, a
  // rotated CSRF token, the one-shot auto-start marker) and costs ~5 provider reads plus a
  // rate-limit unit. The in-place passkey ceremony submits to /login/passkey while this route
  // stays mounted, so RR's default post-submit revalidation would re-run all of it on every
  // ceremony step — the same guard login/index.tsx and /login/passkey already carry.
  const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  };

  it('does NOT re-run the loader for an in-place passkey ceremony submit', () => {
    expect(
      shouldRevalidate({
        formData: form({ passkeyCeremony: '1' }),
        defaultShouldRevalidate: true,
      })
    ).to.equal(false);
  });

  it('revalidates normally for every other submit', () => {
    expect(
      shouldRevalidate({ formData: form({ intent: 'idp' }), defaultShouldRevalidate: true })
    ).to.equal(true);
    expect(shouldRevalidate({ defaultShouldRevalidate: false })).to.equal(false);
  });
});
