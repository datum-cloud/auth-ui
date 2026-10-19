/**
 * Chrome DevTools virtual authenticator helpers. They drive CDP's WebAuthn domain through
 * Cypress's `remote:debugger:protocol` automation so specs run real navigator.credentials
 * ceremonies in Chrome. Chromium-only; the CDP domain is enabled lazily per call chain.
 */
import { PREBAKED_CREDENTIAL_ID, type PASSKEY_U5 } from '../fixtures/passkey-u5';

type Cdp = Record<string, unknown>;

function cdp<T = Cdp>(command: string, params: Cdp = {}): Cypress.Chainable<T> {
  // Lazy on purpose: calling Cypress.automation directly would fire when the helper is invoked
  // while the test body enqueues commands, not when the chain reaches it, so a read such as
  // getCredentials() would see the authenticator as it was before earlier steps ran.
  return cy.then(
    { log: false },
    () => Cypress.automation('remote:debugger:protocol', { command, params }) as Promise<T>
  );
}

/** base64url -> standard base64 (CDP binary fields). */
export function toBase64(b64url: string): string {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return padded + '='.repeat((4 - (padded.length % 4)) % 4);
}

export function addVirtualAuthenticator(): Cypress.Chainable<string> {
  return cdp('WebAuthn.enable', { enableUI: false })
    .then(() =>
      cdp<{ authenticatorId: string }>('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
        },
      })
    )
    .then((res) => res.authenticatorId);
}

export function removeVirtualAuthenticator(id: string): Cypress.Chainable {
  return cdp('WebAuthn.removeVirtualAuthenticator', { authenticatorId: id });
}

/** Plant a resident credential. signCount defaults to a wall-clock value so it always exceeds the
 *  counter the long-lived fake server last saw. */
export function plantCredential(
  id: string,
  fixture: typeof PASSKEY_U5,
  signCount = freshSignCount()
): Cypress.Chainable {
  return cdp('WebAuthn.addCredential', {
    authenticatorId: id,
    credential: {
      credentialId: toBase64(fixture.credentialId),
      isResidentCredential: true,
      rpId: fixture.rpId,
      privateKey: fixture.privateKeyPkcs8B64,
      userHandle: btoa(fixture.userId),
      signCount,
    },
  });
}

export function getCredentials(
  id: string
): Cypress.Chainable<Array<{ credentialId: string; signCount: number }>> {
  return cdp<{ credentials: Array<{ credentialId: string; signCount: number }> }>(
    'WebAuthn.getCredentials',
    { authenticatorId: id }
  ).then((res) => res.credentials);
}

export function setUserVerified(id: string, verified: boolean): Cypress.Chainable {
  return cdp('WebAuthn.setUserVerified', { authenticatorId: id, isUserVerified: verified });
}

export function setAutomaticPresenceSimulation(id: string, enabled: boolean): Cypress.Chainable {
  return cdp('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: id, enabled });
}

function postedCredentialId(body: unknown): string {
  const raw = typeof body === 'string' ? new URLSearchParams(body).get('credential') : null;
  return (JSON.parse(raw ?? '{}') as { id?: string }).id ?? '';
}

/** Wait for the aliased POST and assert it carried the authenticator's own credential, not the
 *  prebaked one. CDP returns standard base64; the posted id is base64url. */
export function expectPostedRealCredential(alias: string, authenticatorId: string): void {
  getCredentials(authenticatorId).then((creds) => {
    expect(creds).to.have.length(1);
    cy.wait(alias).then(({ request }) => {
      const posted = postedCredentialId(request.body);
      cy.task('log', `${alias} posted credential id ${posted}`);
      expect(posted).to.not.eq(PREBAKED_CREDENTIAL_ID);
      expect(toBase64(posted)).to.eq(creds[0].credentialId);
    });
  });
}

/** Visit with hydration on and the app's Cypress ceremony shortcut off (real navigator.credentials). */
export function visitRealWebAuthn(url: string): Cypress.Chainable {
  cy.visit(url, {
    onBeforeLoad: (win) => {
      win.__CYPRESS_HYDRATE__ = true;
      (win as unknown as { __webAuthnRealCeremony?: boolean }).__webAuthnRealCeremony = true;
    },
  });
  return cy.settleHydration();
}

const SIGN_COUNT_EPOCH_MS = Date.UTC(2026, 0, 1);

/** A counter that only grows with wall-clock time (10 ticks/second, well inside uint32). */
export function freshSignCount(): number {
  return Math.floor((Date.now() - SIGN_COUNT_EPOCH_MS) / 100);
}
