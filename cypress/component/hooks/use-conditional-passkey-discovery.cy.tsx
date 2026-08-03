// cypress/component/hooks/use-conditional-passkey-discovery.cy.tsx
//
// The DISCOVERY mode of the conditional ceremony driver: assertion #1 (identity
// claim) posts to /login/passkey-discover via PLAIN fetch (not an RR fetcher —
// see submitDiscover's comment); the response carries the REAL user-bound
// challenge + resolved loginName + fresh csrf, over which the modal ceremony runs
// and submits to the verify action. Failures are non-events and discovery NEVER
// retries (cross-device QR must not force a second round-trip). The discover hop
// is stubbed with cy.intercept (it is a raw fetch); the verify action stays a
// memory-router stub. Sibling of use-conditional-passkey.cy.tsx (hinted mode).
import { useConditionalPasskey } from '@/hooks/use-conditional-passkey';
import { mount } from 'cypress/react';
import React from 'react';
import { createMemoryRouter, redirect, RouterProvider } from 'react-router';

const IDENTITY_OPTIONS = { publicKey: { challenge: 'identity-x', allowCredentials: [] } };
const REAL_OPTIONS = { publicKey: { challenge: 'zitadel-x' } };
const RESOLVED = 'mia@acme.test';

type W = Window & {
  __conditionalPasskeyAutoResolve?: boolean;
  __webAuthnRealCeremony?: boolean;
};

function Harness({ enabled, options }: { enabled: boolean; options: unknown }) {
  const cond = useConditionalPasskey({
    enabled,
    mode: 'discovery',
    loginName: '', // unknown until the discover response resolves it
    csrfToken: 'tok-page',
    publicKeyCredentialRequestOptions: options,
  });
  return (
    <div>
      <div data-testid="phase">{cond.phase}</div>
      <div data-testid="reason">{cond.reason ?? ''}</div>
      <button data-testid="abort" onClick={cond.abort}>
        abort
      </button>
      <button data-testid="begin" onClick={() => cond.beginDiscovery()}>
        begin
      </button>
    </div>
  );
}

function mountHarness({
  enabled = true,
  options = IDENTITY_OPTIONS as unknown,
  discoverReply = undefined as { statusCode: number; body: unknown } | undefined,
  // Holds the discover reply open so a test can act WHILE phase === 'submitting'
  // (the fake path otherwise completes the whole flow synchronously).
  discoverDelayMs = 0,
  verifyResult = undefined as unknown, // undefined → redirect('/signed-in')
} = {}) {
  const discoverPosts: string[] = [];
  const verifyPosts: Array<Record<string, unknown>> = [];
  cy.intercept('POST', '**/id/login/passkey-discover', (req) => {
    discoverPosts.push(String(req.body));
    req.reply({
      ...(discoverReply ?? {
        statusCode: 200,
        body: {
          loginName: RESOLVED,
          csrfToken: 'tok-discover',
          publicKeyCredentialRequestOptions: REAL_OPTIONS,
        },
      }),
      ...(discoverDelayMs ? { delay: discoverDelayMs } : {}),
    });
  }).as('discover');
  const router = createMemoryRouter(
    [
      { path: '/login', element: <Harness enabled={enabled} options={options} /> },
      { path: '/signed-in', element: <div data-testid="signed-in" /> },
      {
        path: '/login/passkey',
        action: async ({ request }: { request: Request }) => {
          verifyPosts.push(Object.fromEntries(await request.formData()));
          return verifyResult ?? redirect('/signed-in');
        },
      },
    ],
    { initialEntries: ['/login'] }
  );
  mount(<RouterProvider router={router} />);
  return { discoverPosts, verifyPosts };
}

describe('useConditionalPasskey — discovery mode', () => {
  afterEach(() => {
    delete (window as W).__conditionalPasskeyAutoResolve;
    delete (window as W).__webAuthnRealCeremony;
  });

  it('full flow: identity tap → discover fetch → modal over the REAL challenge → verify, redirect followed', () => {
    (window as W).__conditionalPasskeyAutoResolve = true;
    const { discoverPosts, verifyPosts } = mountHarness({});
    cy.get('[data-testid="signed-in"]').should('exist');
    cy.then(() => {
      expect(discoverPosts).to.have.length(1);
      // Assertion #1 carries the PAGE csrf; NO RR marker needed — the plain fetch
      // bypasses React Router, so no revalidation exists to suppress.
      const p = new URLSearchParams(discoverPosts[0]);
      expect(p.get('csrf')).to.equal('tok-page');
      expect(p.get('passkeyCeremony')).to.equal(null);
      expect(String(p.get('credential'))).to.contain('"id"');
      // Assertion #2 uses the DISCOVER response's csrf + resolved loginName.
      expect(verifyPosts).to.have.length(1);
      expect(verifyPosts[0].csrf).to.equal('tok-discover');
      expect(verifyPosts[0].loginName).to.equal(RESOLVED);
      expect(verifyPosts[0].passkeyCeremony).to.equal('1');
    });
  });

  it('opaque discover 400 → phase done, NO verify POST (non-event)', () => {
    (window as W).__conditionalPasskeyAutoResolve = true;
    const { verifyPosts } = mountHarness({
      discoverReply: { statusCode: 400, body: { error: 'DISCOVERY_FAILED' } },
    });
    cy.get('[data-testid="phase"]').should('have.text', 'done');
    cy.then(() => expect(verifyPosts).to.have.length(0));
  });

  it('rejected verify → phase done after ONE attempt — discovery never retries', () => {
    (window as W).__conditionalPasskeyAutoResolve = true;
    const { verifyPosts } = mountHarness({
      verifyResult: { error: 'INVALID_CREDENTIALS' },
    });
    cy.get('[data-testid="phase"]').should('have.text', 'done');
    cy.then(() => expect(verifyPosts).to.have.length(1));
  });

  // Also covers the parked state: without auto-resolve the ceremony sits in `armed` and
  // issues no discover POST — asserted here before the abort, on the same mount, so a
  // separate test for it would repeat these exact assertions.
  it('parks in armed without auto-resolve, and abort() retires discovery permanently', () => {
    const { discoverPosts, verifyPosts } = mountHarness({});
    cy.get('[data-testid="phase"]').should('have.text', 'armed');
    cy.get('[data-testid="abort"]').click();
    cy.get('[data-testid="phase"]').should('have.text', 'done');
    cy.then(() => {
      expect(discoverPosts).to.have.length(0);
      expect(verifyPosts).to.have.length(0);
    });
  });

  // ── beginDiscovery: the EXPLICIT (Passkey-button) modal flow ─────────────

  it('beginDiscovery runs the modal flow: discover → verify → redirect (no auto-resolve needed)', () => {
    const { discoverPosts, verifyPosts } = mountHarness({});
    cy.get('[data-testid="phase"]').should('have.text', 'armed'); // ambient parks
    cy.get('[data-testid="begin"]').click();
    cy.get('[data-testid="signed-in"]').should('exist');
    cy.then(() => {
      expect(discoverPosts).to.have.length(1);
      expect(verifyPosts).to.have.length(1);
      expect(verifyPosts[0].loginName).to.equal(RESOLVED);
    });
  });

  it('beginDiscovery works AFTER abort() — explicit intent clears the cancel latch', () => {
    const { verifyPosts } = mountHarness({});
    cy.get('[data-testid="abort"]').click();
    cy.get('[data-testid="phase"]').should('have.text', 'done');
    cy.get('[data-testid="begin"]').click();
    cy.get('[data-testid="signed-in"]').should('exist');
    cy.then(() => expect(verifyPosts).to.have.length(1));
  });

  it('beginDiscovery is single-flight — a second click while submitting is a no-op', () => {
    const { discoverPosts } = mountHarness({ discoverDelayMs: 300 });
    cy.get('[data-testid="begin"]').click();
    cy.get('[data-testid="phase"]').should('have.text', 'submitting');
    cy.get('[data-testid="begin"]').click(); // phase 'submitting' → beginDiscovery() === false
    cy.get('[data-testid="signed-in"]').should('exist');
    cy.then(() => expect(discoverPosts).to.have.length(1));
  });

  it('opaque 400 during beginDiscovery surfaces a reason (message, not silence)', () => {
    const { verifyPosts } = mountHarness({
      discoverReply: { statusCode: 400, body: { error: 'DISCOVERY_FAILED' } },
    });
    cy.get('[data-testid="begin"]').click();
    cy.get('[data-testid="phase"]').should('have.text', 'done');
    cy.get('[data-testid="reason"]').should('have.text', 'not-allowed');
    cy.then(() => expect(verifyPosts).to.have.length(0));
  });
});
