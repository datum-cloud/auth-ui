// cypress/component/routes/login/passkey-stale-session.cy.ts
//
// Staging repro, at the HTTP boundary the browser actually hits:
//   GET /id/login/passkey.data?loginName=…  with a `sessions` cookie whose entry the
//   provider has already terminated (OIDC logout ended the Zitadel session; the signed
//   cookie survived carrying a still-future expirationTs).
//
// byLoginName cannot see a provider-side termination — expirationTs is cookie-local — so the
// dead entry passed its guard and the challenge request threw NOT_FOUND. That was swallowed
// into a null challenge, and WebAuthnButton's `!publicKey` guard then rendered
// "The passkey verification failed. Please try again." before any ceremony ran.
//
// The loader now self-heals. Asserting the Set-Cookie is the point of testing at THIS level
// rather than the service level: the challenge is armed on a NEWLY minted session, so if that
// session never reaches the browser the assertion posts against the dead entry and fails —
// the same bug, moved one step later and harder to spot.
import { callService } from '../../../support/node/call-service';

// Singleton seed: u5 carries a passkey (see conditional-passkey-loader.cy.ts).
const PK_USER = 'passkey-user@acme.test';
const DEAD_SESSION = { id: 'dead-session', token: 'dead-token', loginName: PK_USER };

type PasskeyLoaderBody = { publicKeyCredentialRequestOptions?: unknown; loginName?: string };

describe('/login/passkey loader — session dead provider-side', () => {
  it('arms a fresh challenge and persists the re-minted session', () => {
    callService({
      fn: 'loginPasskeyLoader',
      provider: 'singleton',
      request: {
        url: `http://localhost/id/login/passkey?loginName=${encodeURIComponent(PK_USER)}`,
        sessions: [DEAD_SESSION],
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const body = v.response?.dataBody as PasskeyLoaderBody;

      // Was null before the fix — the button had nothing to hand the authenticator.
      expect(body.publicKeyCredentialRequestOptions, 'challenge armed').to.exist;
      expect(body.loginName).to.equal(PK_USER);

      // The re-minted session MUST ride back, or the assertion verifies against the dead entry.
      const cookies = v.response?.dataSetCookies ?? [];
      expect(
        cookies.some((c: string) => c.startsWith('sessions=')),
        'sessions Set-Cookie present'
      ).to.equal(true);
    });
  });

  it('still bounces to /login when the cookie names nobody the provider knows', () => {
    callService({
      fn: 'loginPasskeyLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login/passkey?loginName=ghost%40acme.test',
        sessions: [{ id: 'dead-session', token: 'dead-token', loginName: 'ghost@acme.test' }],
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response?.isResponse, 'redirect, not rendered data').to.equal(true);
      expect(v.response?.status).to.be.oneOf([301, 302, 303, 307, 308]);
    });
  });
});
