import { PASSKEY_U5 } from '../fixtures/passkey-u5';
import { checkA11y } from '../support/a11y';
import { loginAndGetSession } from '../support/session';
import {
  addVirtualAuthenticator,
  getCredentials,
  plantCredential,
  removeVirtualAuthenticator,
  setUserVerified,
  toBase64,
  visitRealWebAuthn,
} from '../support/virtual-authenticator';

describe('Passkey verify (/login/passkey)', () => {
  const PASSKEY_URL = '/id/login/passkey?loginName=passkey-user%40acme.test';
  const PASSKEY_BUTTON = /sign in with .*passkey|touch id|windows hello/i;
  let authenticatorId: string;

  beforeEach(() => {
    addVirtualAuthenticator().then((id) => {
      authenticatorId = id;
      plantCredential(id, PASSKEY_U5);
    });
  });

  afterEach(() => {
    if (authenticatorId) removeVirtualAuthenticator(authenticatorId);
    authenticatorId = '';
  });

  it('renders accessibly, signs in with a real passkey ceremony, redirects to /signed-in', () => {
    loginAndGetSession('passkey-user@acme.test');
    visitRealWebAuthn(PASSKEY_URL);

    checkA11y();

    cy.contains('button', PASSKEY_BUTTON).should('not.be.disabled').click();
    cy.location('pathname').should('eq', '/id/signed-in');

    // Chrome's getCredentials does not surface the bumped counter, so assert the planted
    // resident credential is still the one on the authenticator; counter advance is proven by
    // the next test (the fake provider rejects a non-increasing counter on the second sign-in).
    getCredentials(authenticatorId).then((creds) => {
      expect(creds).to.have.length(1);
      expect(creds[0].credentialId).to.eq(toBase64(PASSKEY_U5.credentialId));
    });
  });

  it('signs in twice with the same passkey', () => {
    loginAndGetSession('passkey-user@acme.test');
    visitRealWebAuthn(PASSKEY_URL);
    cy.contains('button', PASSKEY_BUTTON).should('not.be.disabled').click();
    cy.location('pathname').should('eq', '/id/signed-in');

    cy.get('form[action="/id/logout?index"]').submit();
    cy.location('pathname').should('eq', '/id/logout/success');

    loginAndGetSession('passkey-user@acme.test');
    visitRealWebAuthn(PASSKEY_URL);
    cy.contains('button', PASSKEY_BUTTON).should('not.be.disabled').click();
    cy.location('pathname').should('eq', '/id/signed-in');
  });

  it('refused user verification stays on the passkey screen with an error', () => {
    loginAndGetSession('passkey-user@acme.test');
    visitRealWebAuthn(PASSKEY_URL);

    setUserVerified(authenticatorId, false);
    cy.contains('button', PASSKEY_BUTTON).should('not.be.disabled').click();

    cy.contains('[role="alert"]', 'Passkey sign-in was cancelled').should('be.visible');
    cy.location('pathname').should('eq', '/id/login/passkey');
  });
});

describe('Passkey / security-key — no session guard', () => {
  it('redirects to /login when visiting passkey screen without a session', () => {
    cy.visit('/id/login/passkey?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });

  it('redirects to /login when visiting security-key screen without a session', () => {
    cy.visit('/id/login/security-key?loginName=nobody%40acme.test', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/id/login');
  });
});
