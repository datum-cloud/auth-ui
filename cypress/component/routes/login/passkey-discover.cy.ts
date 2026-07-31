// cypress/component/routes/login/passkey-discover.cy.ts
//
// /login/passkey-discover action — the identity-resolution step of the usernameless
// discovery path (spec: 2026-07-31-usernameless-passkey-discovery-design.md).
// The posted assertion is an UNTRUSTED identity claim: only response.userHandle is
// read (== Zitadel userId). Every user-dependent failure must collapse into ONE
// opaque 400 (enumeration parity with the identifier form). The action returns
// plain Response.json (direct-fetch API, not an RR fetcher target). Node-bound
// action spec: signed sessions cookie + CSRF round-trip (see passkey-hint-write.cy.ts).
import { callService } from '../../../support/node/call-service';

const PK_USER = 'passkey-user@acme.test'; // u5, authMethods ['password','passkey']
const B64_U5 = 'dTU'; // base64url('u5')
const B64_U1 = 'dTE'; // base64url('u1') — alice, authMethods ['password'] only
const B64_UNKNOWN = 'bm8tc3VjaC11c2Vy'; // base64url('no-such-user')

/** Minimal marshalled-assertion JSON — discover reads ONLY response.userHandle. */
function assertionWith(userHandle: string | null): string {
  return JSON.stringify({
    id: 'cred-1',
    rawId: 'cred-1',
    type: 'public-key',
    response: {
      authenticatorData: 'x',
      clientDataJSON: 'x',
      signature: 'x',
      userHandle,
    },
  });
}

const URL = 'http://localhost/id/login/passkey-discover';

describe('/login/passkey-discover action', () => {
  it('resolves the userHandle to a user-bound challenge; sessions cookie set, NO passkey-hint', () => {
    callService({
      fn: 'passkeyDiscoverAction',
      provider: 'singleton',
      request: {
        url: URL,
        form: { credential: assertionWith(B64_U5) },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(200);
      const body = v.response?.dataBody as {
        loginName?: string;
        csrfToken?: string;
        publicKeyCredentialRequestOptions?: unknown;
      };
      expect(body.loginName).to.equal(PK_USER);
      expect(body.csrfToken).to.be.a('string').and.not.be.empty;
      expect(body.publicKeyCredentialRequestOptions, 'real Zitadel-issued options').to.exist;
      const cookies = v.response?.setCookies ?? [];
      expect(
        cookies.some((c) => c.startsWith('sessions=')),
        'ceremony session entry persisted'
      ).to.equal(true);
      // Hint invariant: "last successfully AUTHENTICATED user" — the verify action
      // writes it on success; discover must NOT (spec, design decisions).
      expect(
        cookies.some((c) => c.startsWith('passkey-hint=')),
        'no hint write on discover'
      ).to.equal(false);
      // Observability: success emits the audit event with a HASHED actor.
      const success = v.audit?.find(
        (a) => a.event === 'passkey_discover' && a.outcome === 'success'
      ) as { actor?: string } | undefined;
      expect(success, 'passkey_discover success audit').to.exist;
      expect(success?.actor).to.be.a('string').and.not.contain('@');
    });
  });

  it('kill switch (AUTH_PASSKEY_DISCOVERY_ENABLED=false) → the SAME opaque 400', () => {
    callService({
      fn: 'passkeyDiscoverAction',
      provider: 'singleton',
      env: { AUTH_PASSKEY_DISCOVERY_ENABLED: 'false' },
      request: { url: URL, form: { credential: assertionWith(B64_U5) }, csrf: true },
    }).then((v) => {
      expect(v.response?.status).to.equal(400);
      expect((v.response?.dataBody as { error?: string }).error).to.equal('DISCOVERY_FAILED');
      expect(
        v.audit?.some(
          (a) =>
            a.event === 'passkey_discover' &&
            a.outcome === 'failure' &&
            (a as { reason?: string }).reason === 'disabled'
        ),
        'audited as disabled'
      ).to.equal(true);
    });
  });

  it('absent userHandle (non-resident key) → opaque DISCOVERY_FAILED 400', () => {
    callService({
      fn: 'passkeyDiscoverAction',
      provider: 'singleton',
      request: { url: URL, form: { credential: assertionWith(null) }, csrf: true },
    }).then((v) => {
      expect(v.response?.status).to.equal(400);
      expect((v.response?.dataBody as { error?: string }).error).to.equal('DISCOVERY_FAILED');
    });
  });

  it('unknown userHandle → the SAME opaque DISCOVERY_FAILED 400, real reason in the audit', () => {
    callService({
      fn: 'passkeyDiscoverAction',
      provider: 'singleton',
      request: { url: URL, form: { credential: assertionWith(B64_UNKNOWN) }, csrf: true },
    }).then((v) => {
      expect(v.response?.status).to.equal(400);
      expect((v.response?.dataBody as { error?: string }).error).to.equal('DISCOVERY_FAILED');
      // Enumeration parity is CALLER-facing only — operators get the specific reason.
      expect(
        v.audit?.some(
          (a) =>
            a.event === 'passkey_discover' &&
            a.outcome === 'failure' &&
            (a as { reason?: string }).reason === 'unresolved_user'
        ),
        'audited as unresolved_user'
      ).to.equal(true);
    });
  });

  it('user without a passkey method → the SAME opaque DISCOVERY_FAILED 400', () => {
    callService({
      fn: 'passkeyDiscoverAction',
      provider: 'singleton',
      request: { url: URL, form: { credential: assertionWith(B64_U1) }, csrf: true },
    }).then((v) => {
      expect(v.response?.status).to.equal(400);
      expect((v.response?.dataBody as { error?: string }).error).to.equal('DISCOVERY_FAILED');
    });
  });

  it('live session for the resolved user → opaque 400 (crafted-POST supersede guard)', () => {
    // The loader suppresses discovery when a live session exists; a crafted POST must
    // not bypass that and supersede a LIVE cookie entry via armUserBoundChallenge.
    callService({
      fn: 'passkeyDiscoverAction',
      provider: 'singleton',
      liveSessions: [{ id: 's5', token: 't5', user: { id: 'u5', loginName: PK_USER } }],
      request: {
        url: URL,
        sessions: [{ id: 's5', token: 't5', loginName: PK_USER }],
        form: { credential: assertionWith(B64_U5) },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(400);
      expect((v.response?.dataBody as { error?: string }).error).to.equal('DISCOVERY_FAILED');
    });
  });

  it('malformed credential JSON → opaque DISCOVERY_FAILED 400 (shape violations are non-events)', () => {
    callService({
      fn: 'passkeyDiscoverAction',
      provider: 'singleton',
      request: { url: URL, form: { credential: 'not-json{' }, csrf: true },
    }).then((v) => {
      expect(v.response?.status).to.equal(400);
      expect((v.response?.dataBody as { error?: string }).error).to.equal('DISCOVERY_FAILED');
    });
  });

  it('missing credential field → INVALID_INPUT 400 (schema boundary, not user-dependent)', () => {
    callService({
      fn: 'passkeyDiscoverAction',
      provider: 'singleton',
      request: { url: URL, form: {}, csrf: true },
    }).then((v) => {
      expect(v.response?.status).to.equal(400);
      expect((v.response?.dataBody as { error?: string }).error).to.equal('INVALID_INPUT');
    });
  });
});
