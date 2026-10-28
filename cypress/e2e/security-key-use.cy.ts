import { SECURITY_KEY_U6 } from '../fixtures/security-key-u6';
import { checkA11y } from '../support/a11y';
import { loginAndGetSession } from '../support/session';
import {
  addVirtualAuthenticator,
  expectPostedRealCredential,
  plantCredential,
  removeVirtualAuthenticator,
  visitRealWebAuthn,
} from '../support/virtual-authenticator';

describe('Security key verify (/login/security-key)', () => {
  let authenticatorId: string;

  beforeEach(() => {
    addVirtualAuthenticator('security-key').then((id) => {
      authenticatorId = id;
      plantCredential(id, SECURITY_KEY_U6, undefined, false);
    });
  });

  afterEach(() => {
    if (authenticatorId) removeVirtualAuthenticator(authenticatorId);
    authenticatorId = '';
  });

  it('renders accessibly, signs in with a real security key, redirects to /signed-in', () => {
    loginAndGetSession('u2f-user@acme.test');
    visitRealWebAuthn('/id/login/security-key?loginName=u2f-user%40acme.test');

    checkA11y();

    cy.intercept('POST', /\/id\/login\/security-key(\.data)?(\?|$)/).as('verify');
    cy.contains('button', /verify with security key/i)
      .should('not.be.disabled')
      .click();

    expectPostedRealCredential('@verify', authenticatorId);
    cy.location('pathname').should('eq', '/id/signed-in');
  });
});
