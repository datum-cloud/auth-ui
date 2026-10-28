// Post-deploy check: the long-lived staging account signs in with its passkey through the
// usernameless "Passkey" button on deployed staging. Run by the `staging-passkey-check` CI job
// after each merge to main; setup and secret formats are in acceptance/PASSKEY-TESTING.md.
//
// Gated: runs only with `--env STAGING_PASSKEY=1` and baseUrl set to the staging origin.
import {
  addVirtualAuthenticator,
  plantCredential,
  removeVirtualAuthenticator,
  visitRealWebAuthn,
  type WebAuthnFixture,
} from '../cypress/support/virtual-authenticator';

const RUN = String(Cypress.expose('STAGING_PASSKEY') ?? '') === '1';

const setting = (name: string): string => String(Cypress.expose(name) ?? '');

(RUN ? describe : describe.skip)('staging passkey sign-in', () => {
  const loginName = setting('STAGING_PASSKEY_LOGIN_NAME');
  const fixture: WebAuthnFixture = {
    credentialId: setting('STAGING_PASSKEY_CREDENTIAL_ID'),
    privateKeyPkcs8B64: setting('STAGING_PASSKEY_PRIVATE_KEY'),
    userId: setting('STAGING_PASSKEY_USER_HANDLE'),
    rpId: 'auth.staging.env.datum.net',
  };
  let authenticatorId = '';

  // Never put a secret into an assertion: chai prints values into the command log, and failure
  // screenshots of that log are uploaded from a public repo.
  before(() => {
    for (const [name, value] of Object.entries({ loginName, ...fixture })) {
      if (!value) throw new Error(`${name} is not set`);
    }
  });

  beforeEach(() => {
    addVirtualAuthenticator().then((id) => {
      authenticatorId = id;
      plantCredential(id, fixture);
    });
  });

  afterEach(() => {
    if (authenticatorId) removeVirtualAuthenticator(authenticatorId);
    authenticatorId = '';
  });

  it('usernameless passkey sign-in reaches the post-sign-in redirect', () => {
    cy.intercept('POST', /\/id\/login\/passkey(\.data)?(\?|$)/).as('verify');
    // /id/signed-in 302s to another origin; record the status and keep the browser here.
    cy.intercept('GET', '**/id/signed-in*', (req) => {
      req.continue((res) => {
        res.headers['x-observed-status'] = String(res.statusCode);
        res.statusCode = 200;
        res.body = 'redirect-observed';
      });
    }).as('signedIn');

    // Hydrates, and turns off the app's Cypress shortcut so navigator.credentials runs for real.
    visitRealWebAuthn('/id/login');
    cy.contains('button', /passkey/i).click();

    cy.wait('@verify', { log: false }).then(({ request }) => {
      const form = new URLSearchParams(String(request.body));
      const credential = JSON.parse(form.get('credential') ?? '{}') as { id?: string };
      if (credential.id !== fixture.credentialId) {
        throw new Error('The verify POST did not carry the planted credential');
      }
      if (String(form.get('loginName')).toLowerCase() !== loginName.toLowerCase()) {
        throw new Error(
          'The passkey resolved to a different account than STAGING_PASSKEY_LOGIN_NAME'
        );
      }
    });
    // A client-side navigation fetches /id/signed-in.data, where React Router sends a redirect as 202.
    cy.wait('@signedIn').then(({ request, response }) => {
      const expected = new URL(request.url).pathname.endsWith('.data') ? '202' : '302';
      expect(response?.headers?.['x-observed-status'], 'sign-in redirect').to.eq(expected);
    });
  });
});

export {};
