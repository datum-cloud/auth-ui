// cypress/component/routes/setup/setup-passkey-naming.cy.tsx
//
// Name-after-ceremony: /setup/passkey runs the create() ceremony FIRST (only
// ordering where the AAGUID — available only in the returned attestation — can
// pre-fill the name), then shows a Save-only name step, then submits the held
// credential + passkeyName to the enroll action. Uses a createMemoryRouter harness
// whose action RECORDS the posted FormData; the route has no loader here, so
// post-action revalidation is a no-op and hydrated loaderData persists.
import { attestationObject, authDataWith } from '../../../support/attestation-fixture';
import type { WebAuthnEnrollActionData } from '@/resources/webauthn';
import { defaultPasskeyName } from '@/resources/webauthn/aaguid';
import { base64UrlToBuffer } from '@/resources/webauthn/webauthn';
import SetupPasskey from '@/routes/setup/passkey';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

interface Recorded {
  fields?: Record<string, string>;
}

// createAttestation() reads challenge/user.id/excludeCredentials — a minimal valid shape.
const PK_CREATE = { challenge: 'YQ', user: { id: 'YQ' }, excludeCredentials: [] };

const LOADER_DATA = {
  csrfToken: 'tok-1',
  loginName: 'a@b.test',
  requestId: 'rq1',
  organization: 'acme',
  force: undefined,
  checkAfter: undefined,
  credentialId: 'pk1',
  publicKey: PK_CREATE,
  challengeFailed: false,
  returnTo: null,
};

function mountRoute(
  recorded: Recorded,
  actionError?: WebAuthnEnrollActionData['error'],
  loaderOverrides?: Partial<typeof LOADER_DATA>
) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const loaderData = { ...LOADER_DATA, ...loaderOverrides };
  const router = createMemoryRouter(
    [
      {
        id: 'setup-passkey',
        path: '/setup/passkey',
        element: (
          <I18nProvider i18n={i18n}>
            <ConformAdapter>
              <SetupPasskey />
            </ConformAdapter>
          </I18nProvider>
        ),
        action: async ({ request }) => {
          const form = await request.formData();
          recorded.fields = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
          return actionError ? { error: actionError } : null;
        },
        // Deviation from the brief: React Router's mergeLoaderData only carries hydrated
        // loaderData forward across a post-action revalidation when `match.route.loader` is
        // truthy (see mergeLoaderData in react-router's router.ts) — a loader-less route's
        // entry is dropped, not preserved, crashing useLoaderData's destructure on the
        // subsequent render. The brief's spec comment ("no-op and hydrated loaderData
        // persists") does not hold for react-router@7.18. A trivial loader mirrors the real
        // route (which always has one) and keeps loaderData stable across the action.
        loader: async () => loaderData,
      },
    ],
    {
      initialEntries: ['/setup/passkey'],
      hydrationData: { loaderData: { 'setup-passkey': loaderData } },
    }
  );
  return mount(<RouterProvider router={router} />);
}

describe('setup/passkey — name-after-ceremony', () => {
  // Deviation from the brief: Cypress component testing does not reload the AUT window
  // between tests in the same spec (unlike e2e's testIsolation page reset), so the
  // real-ceremony opt-in flag set by the AAGUID test below would otherwise leak into
  // later tests and make them attempt the real navigator.credentials.create path.
  afterEach(() => {
    cy.window().then((win) => {
      delete (win as unknown as { __webAuthnRealCeremony?: boolean }).__webAuthnRealCeremony;
    });
  });

  it('runs the ceremony first, then shows the Save-only name step pre-filled from the device', () => {
    const recorded: Recorded = {};
    mountRoute(recorded);

    // Step 1: no name input — the AAGUID needed for the pre-fill exists only after the ceremony.
    cy.contains('button', 'Register passkey').should('not.be.disabled');
    cy.get('input[name="passkeyName"]').should('not.exist');

    cy.contains('button', 'Register passkey').click();

    // Step 2: pre-filled (pre-baked credential has no attestationObject → UA fallback),
    // scoping helptext + no-rename note, Save-only (Register gone, no cancel).
    cy.contains(/Name your passkey/i).should('exist');
    cy.window().then((win) => {
      const expected = defaultPasskeyName(null, win.navigator.userAgent);
      cy.get('input[name="passkeyName"]').should('have.value', expected);
    });
    cy.contains('your password manager labels it separately').should('be.visible');
    cy.contains("Names can't be changed later").should('be.visible');
    cy.contains('button', 'Register passkey').should('not.exist');
    cy.contains('button', /cancel/i).should('not.exist');
  });

  it('submits the held credential with the edited name (edited-name-reaches-verify)', () => {
    const recorded: Recorded = {};
    mountRoute(recorded, undefined, { returnTo: '/passkeys' });
    cy.contains('button', 'Register passkey').should('not.be.disabled').click();
    cy.get('input[name="passkeyName"]').clear();
    cy.get('input[name="passkeyName"]').type('My yubikey');
    cy.contains('button', 'Save').click();
    cy.wrap(recorded).should((r) => {
      expect(r.fields, 'action received the form').to.not.equal(undefined);
      expect(r.fields!.passkeyName).to.equal('My yubikey');
      expect(JSON.parse(r.fields!.credential)).to.have.property('id', 'fake-credential-id');
      expect(r.fields!.passkeyId).to.equal('pk1');
      expect(r.fields!.returnTo).to.equal('/passkeys');
    });
  });

  it('pre-fills the catalog name from the attestation AAGUID and shows the device hint', () => {
    const recorded: Recorded = {};
    mountRoute(recorded);

    // Opt INTO the real ceremony (documented __webAuthnRealCeremony seam) and resolve
    // create() with a crafted Apple Passwords attestation (AAGUID fbfc3007-…).
    cy.window().then((win) => {
      (win as unknown as { __webAuthnRealCeremony?: boolean }).__webAuthnRealCeremony = true;
      const w = win as unknown as { PublicKeyCredential?: unknown };
      if (typeof w.PublicKeyCredential === 'undefined') {
        w.PublicKeyCredential = function () {} as unknown;
      }
      if (!win.navigator.credentials) {
        Object.defineProperty(win.navigator, 'credentials', {
          value: { create: () => Promise.resolve(null), get: () => Promise.resolve(null) },
          configurable: true,
        });
      }
      const attB64 = attestationObject(authDataWith(0x45, 'fbfc3007154e4ecc8c0b6e020557d7bd'));
      cy.stub(win.navigator.credentials, 'create').resolves({
        id: 'real-cred',
        rawId: base64UrlToBuffer('cmVhbC1jcmVk'),
        type: 'public-key',
        response: {
          attestationObject: base64UrlToBuffer(attB64),
          clientDataJSON: base64UrlToBuffer('e30'),
        },
      });
    });

    cy.contains('button', 'Register passkey').should('not.be.disabled').click();

    // Catalog name wins the pre-fill; the UA-derived hint differs → rendered.
    cy.get('input[name="passkeyName"]').should('have.value', 'Apple Passwords');
    cy.contains(/Created using/).should('be.visible');
  });

  it('auto-resets to step 1 when the verify action fails (challenge expiry)', () => {
    const recorded: Recorded = {};
    mountRoute(recorded, 'INVALID_CREDENTIALS');

    cy.contains('button', 'Register passkey').should('not.be.disabled').click();
    cy.get('input[name="passkeyName"]').should('exist');
    cy.contains('button', 'Save').click();

    // Back on step 1 with the inline error — one click retries the full ceremony.
    cy.get('[role="alert"]').should('exist');
    cy.get('input[name="passkeyName"]').should('not.exist');
    cy.contains('button', 'Register passkey').should('not.be.disabled');

    // The controlled hidden input must drop the stale credential with the reset.
    cy.get('input[name="credential"]').should('have.value', '');

    // Re-entering the name step must not carry the stale failure banner.
    cy.contains('button', 'Register passkey').click();
    cy.contains(/Name your passkey/i).should('exist');
    cy.get('[role="alert"]').should('not.exist');
  });
});
