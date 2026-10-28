import {
  addVirtualAuthenticator,
  expectPostedRealCredential,
  removeVirtualAuthenticator,
  visitRealWebAuthn,
} from '../support/virtual-authenticator';

// Issue #153: the signup terminal signs the new user in with the passkey they just registered.
// No credential is planted; registration must create it on the virtual authenticator, and the
// fake provider then verifies the real assertion on the automatic sign-in.
describe('Signup → passkey registration → automatic sign-in', () => {
  let authenticatorId: string;

  beforeEach(() => {
    addVirtualAuthenticator().then((id) => {
      authenticatorId = id;
    });
  });

  afterEach(() => {
    if (authenticatorId) removeVirtualAuthenticator(authenticatorId);
    authenticatorId = '';
  });

  it('registers a passkey after verifying the email and signs in automatically', () => {
    // The window flags visitRealWebAuthn sets do not survive a redirected cy.visit (they are
    // gone from the document the redirect lands on). Follow the verification link with
    // cy.request, which verifies the email and sets the session cookie, then visit the page it
    // redirects to directly.
    cy.request({
      url: '/id/signup/complete?code=email-u1&userId=u1&next=passkey',
      followRedirect: false,
    }).then((r) => {
      const loc = r.headers.location as string;
      expect(new URL(loc, 'http://x').pathname).to.eq('/id/setup/passkey');
      visitRealWebAuthn(loc);
    });
    cy.intercept('POST', '**/id/setup/passkey*').as('register');
    cy.intercept('POST', '**/id/login/passkey*').as('signIn');

    cy.contains('button', 'Register passkey').should('not.be.disabled').click();

    // Naming step follows the ceremony; accept the pre-filled name.
    cy.contains(/Name your passkey/i).should('be.visible');
    cy.contains('button', /^save$/i).click();

    // The terminal is reached, then signs in with the new passkey without another click.
    cy.location('pathname').should('eq', '/id/signup/success');
    cy.location('pathname').should('eq', '/id/signed-in');

    // Both POSTs carried the authenticator's own credential, not the pre-baked one.
    for (const alias of ['@register', '@signIn'] as const)
      expectPostedRealCredential(alias, authenticatorId);
  });
});
