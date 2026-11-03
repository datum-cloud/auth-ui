import { loginAndGetSession } from '../support/session';

// GET /id/logout?logout_token=… used to sign the user out of every session without reading the
// token, so any third-party page could force that navigation (the cookie is SameSite=Lax) and
// sign the victim out everywhere. The GET now only renders the confirm page; the sign-out of
// every account runs from the CSRF-protected POST that page submits.
function signInAsAlice(): void {
  loginAndGetSession('alice@acme.test');
  cy.visit('/id/signed-in');
  cy.contains('alice@acme.test');
}

describe('logout_token GET (end_session handshake)', () => {
  it('a forged logout_token leaves the sessions cookie intact', () => {
    signInAsAlice();
    cy.getCookie('sessions').should('exist').its('value').as('before');

    cy.request({ url: '/id/logout?logout_token=garbage', followRedirect: false }).then((res) => {
      expect(res.status, 'renders the confirm page, no redirect').to.equal(200);
      const setCookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      expect(
        setCookies.some((c) => c.startsWith('sessions=')),
        'the GET never rewrites the sessions cookie'
      ).to.equal(false);
    });

    cy.get('@before').then((before) => {
      cy.getCookie('sessions').its('value').should('eq', before);
    });
    cy.visit('/id/signed-in');
    cy.contains('alice@acme.test');
  });

  it('confirming the end_session page signs out of every account', () => {
    signInAsAlice();
    cy.visit('/id/logout?logout_token=garbage');
    cy.get('input[name="scope"][value="all"]').closest('form').submit();
    cy.location('pathname').should('eq', '/id/logout/success');
    cy.visit('/id/signed-in');
    cy.contains('alice@acme.test').should('not.exist');
  });
});
