// cypress/component/routes/login/discovery-loader.cy.ts
//
// The /login loader's identity-discovery arming + suppression list, at the HTTP
// boundary. Discovery
// arms ONLY for the hintless population — and a discovery arm must be free:
// self-minted options, NO Zitadel session, NO Set-Cookie. Sibling of
// conditional-passkey-loader.cy.ts (the hinted path).
import { callService } from '../../../support/node/call-service';

const PK_USER = 'passkey-user@acme.test'; // u5, authMethods ['password','passkey']
const URL_BASE = 'http://localhost/id/login?organization=org1';

type LoaderBody = {
  conditionalPasskey?: { loginName?: string } | null;
  identityDiscovery?: {
    publicKeyCredentialRequestOptions?: { publicKey?: Record<string, unknown> };
  } | null;
};

describe('/login loader — identity-discovery arming', () => {
  it('no hint, no session → arms discovery: self-minted options, NO Zitadel mint, NO cookies', () => {
    callService({ fn: 'loginLoader', provider: 'singleton', request: { url: URL_BASE } }).then(
      (v) => {
        const body = v.response?.dataBody as LoaderBody;
        expect(body.conditionalPasskey).to.equal(null);
        const pk = body.identityDiscovery?.publicKeyCredentialRequestOptions?.publicKey;
        expect(pk, 'self-minted options present').to.exist;
        expect(pk?.allowCredentials).to.deep.equal([]);
        expect(pk?.userVerification).to.equal('discouraged');
        expect(pk?.challenge).to.be.a('string').and.not.be.empty;
        expect(pk?.rpId).to.equal('localhost');
        // Free by design: no ceremony session minted, nothing persisted.
        expect(
          (v.response?.dataSetCookies ?? []).some((c: string) => c.startsWith('sessions='))
        ).to.equal(false);
      }
    );
  });

  it('?add=1 suppresses discovery (explicit intent)', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: `${URL_BASE}&add=1` },
    }).then((v) => {
      expect((v.response?.dataBody as LoaderBody).identityDiscovery).to.equal(null);
    });
  });

  it('ANY live session suppresses discovery', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      liveSessions: [{ id: 's5', token: 't5', user: { id: 'u5', loginName: PK_USER } }],
      request: {
        url: URL_BASE,
        sessions: [{ id: 's5', token: 't5', loginName: PK_USER }],
      },
    }).then((v) => {
      expect((v.response?.dataBody as LoaderBody).identityDiscovery).to.equal(null);
    });
  });

  it('a STALE (expired) session entry does NOT suppress discovery', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: {
        url: URL_BASE,
        sessions: [
          {
            id: 's-old',
            token: 't-old',
            loginName: PK_USER,
            expirationTs: '2020-01-01T00:00:00.000Z',
          },
        ],
      },
    }).then((v) => {
      const body = v.response?.dataBody as LoaderBody;
      expect(body.identityDiscovery?.publicKeyCredentialRequestOptions).to.exist;
    });
  });

  it('kill switch (AUTH_PASSKEY_DISCOVERY_ENABLED=false) suppresses discovery arming', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      env: { AUTH_PASSKEY_DISCOVERY_ENABLED: 'false' },
      request: { url: URL_BASE },
    }).then((v) => {
      expect((v.response?.dataBody as LoaderBody).identityDiscovery).to.equal(null);
    });
  });

  it('hint present → hinted path arms, discovery stays dark', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: URL_BASE, passkeyHint: PK_USER },
    }).then((v) => {
      const body = v.response?.dataBody as LoaderBody;
      expect(body.conditionalPasskey?.loginName).to.equal(PK_USER);
      expect(body.identityDiscovery).to.equal(null);
    });
  });
});
