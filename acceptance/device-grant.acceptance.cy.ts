// OAuth Device Authorization Grant (RFC 8628) acceptance (real Zitadel).
// Mints a real device_authorization, drives /id/device → consent → login ceremony →
// post-login return-to-consent → approve, then proves the grant end-to-end by polling
// the device token endpoint until it stops returning authorization_pending and issues
// an access token.
//
// Gated: runs only with `--env ACCEPTANCE=1`. App must run with AUTH_PROVIDER=zitadel
// against the local stack; the cypress process needs NODE_EXTRA_CA_CERTS=./dev-ca.crt so
// cy.request can reach Zitadel over the self-signed dev CA. See the INDEX log (2026-06-13).

const RUN = String(Cypress.env('ACCEPTANCE') ?? '') === '1';

const ZITADEL = String(Cypress.env('ZITADEL_API_URL') ?? 'https://auth.localtest.me:30000');
// Device client `auth-ui-e2e-device` (device grant enabled; codes are throwaway).
const CLIENT_ID = String(Cypress.env('DEVICE_CLIENT_ID') ?? '377158965391327283');
// user2 is the CLEAN password-only ceremony user (user3 has live TOTP enrolled).
const LOGIN_NAME = String(Cypress.env('ACCEPTANCE_LOGIN_NAME') ?? 'zitadel-e2e-user2');
const PASSWORD = String(Cypress.env('ACCEPTANCE_PASSWORD') ?? 'LocalDev-Passw0rd!');

const TOKEN_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
// RFC 8628 §3.5 recommends a 5 s poll interval; we use 1 s against the local
// Zitadel stack (fast, same machine). 10 attempts × 1 s = 10 s budget, which
// comfortably covers slow container startup and consent propagation lag.
const POLL_ATTEMPTS = 10;
const POLL_DELAY_MS = 1000;

/** Poll the device token endpoint until it issues a token (or attempts run out). */
function pollToken(deviceCode: string, attempt: number): void {
  cy.request({
    method: 'POST',
    url: `${ZITADEL}/oauth/v2/token`,
    form: true,
    body: { grant_type: TOKEN_GRANT, device_code: deviceCode, client_id: CLIENT_ID },
    failOnStatusCode: false,
  }).then((resp) => {
    if (resp.status === 200 && resp.body.access_token) {
      expect(resp.body.access_token, 'device grant issued an access token').to.be.a('string');
      return;
    }
    expect(resp.body.error, 'pending until consent lands').to.eq('authorization_pending');
    expect(attempt, 'token endpoint never issued a token').to.be.lessThan(POLL_ATTEMPTS);
    cy.wait(POLL_DELAY_MS);
    pollToken(deviceCode, attempt + 1);
  });
}

(RUN ? describe : describe.skip)('Device authorization grant (real Zitadel)', () => {
  it('user code → login ceremony → consent approve → token endpoint issues a token', () => {
    cy.request({
      method: 'POST',
      url: `${ZITADEL}/oauth/v2/device_authorization`,
      form: true,
      body: { client_id: CLIENT_ID, scope: 'openid' },
    }).then((mint) => {
      expect(mint.status).to.eq(200);
      const userCode = String(mint.body.user_code);
      const deviceCode = String(mint.body.device_code);

      // 1) user enters the code shown on the device
      cy.visit('/id/device');
      cy.get('input[name="userCode"]').type(userCode);
      cy.get('button[type="submit"]').first().click();

      // 2) consent screen resolves the device auth; requestId carries the stable user code
      cy.location('pathname').should('eq', '/id/device/authorize');
      cy.location('search').should('include', `user_code=${userCode}`);

      // 3) approving without a session bounces through the login ceremony
      cy.get('button[name="decision"][value="authorize"]').click();
      cy.location('pathname').should('eq', '/id/login');
      cy.location('search').should('include', `requestId=device_${userCode}`);

      cy.get('input[name="loginName"]').type(LOGIN_NAME);
      cy.get('button[type="submit"]').first().click();

      cy.location('pathname').should('eq', '/id/login/password');
      cy.get('input[name="password"]').type(PASSWORD, { log: false });
      cy.get('button[type="submit"]').first().click();

      // 4) post-password: either the skippable MFA prompt or straight back to consent
      cy.location('pathname', { timeout: 10000 }).should(
        'match',
        /\/id\/(setup\/mfa|device\/authorize)$/
      );
      cy.location('pathname').then((path) => {
        if (path === '/id/setup/mfa') {
          cy.contains('button', /skip for now/i).click();
        }
      });

      // 5) post-login return-to-consent: the ceremony threads device_<userCode> back
      // through /authorize, which re-derives ?user_code= for the consent screen
      cy.location('pathname', { timeout: 10000 }).should('eq', '/id/device/authorize');
      cy.location('search').should('include', `user_code=${userCode}`);

      // 6) approve with the signed-in session → in-page completion state
      cy.get('button[name="decision"][value="authorize"]').click();
      cy.contains('You may return to your device', { timeout: 10000 }).should('be.visible');

      // 7) end-to-end proof: the token endpoint flips from authorization_pending to a token
      pollToken(deviceCode, 1);
    });
  });
});

// Module scope: prevents top-level const collisions across acceptance specs under tsc.
export {};
