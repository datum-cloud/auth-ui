// cypress/component/routes/login/passkey-discover.cy.ts
//
// /login/passkey-discover action — the identity-resolution step of the usernameless
// discovery path.
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
      // writes it on success; discover must NOT.
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

  // ENUMERATION PARITY: every user-dependent failure must collapse into the SAME opaque
  // 400, so a caller cannot distinguish "no such user" from "user has no passkey" from
  // "key is non-resident". One table precisely because the property IS that these inputs
  // are indistinguishable to the caller — scattered across separate tests it reads as
  // coincidence rather than contract.
  //
  // Where an operator-facing audit reason exists it is asserted per row: parity is
  // caller-facing only, and operators must still get the specific cause.
  const OPAQUE_FAILURES: Array<{
    label: string;
    scenario: Parameters<typeof callService>[0];
    auditReason?: string;
  }> = [
    {
      label: 'kill switch (AUTH_PASSKEY_DISCOVERY_ENABLED=false)',
      scenario: {
        fn: 'passkeyDiscoverAction',
        provider: 'singleton',
        env: { AUTH_PASSKEY_DISCOVERY_ENABLED: 'false' },
        request: { url: URL, form: { credential: assertionWith(B64_U5) }, csrf: true },
      },
      auditReason: 'disabled',
    },
    {
      label: 'absent userHandle (non-resident key)',
      scenario: {
        fn: 'passkeyDiscoverAction',
        provider: 'singleton',
        request: { url: URL, form: { credential: assertionWith(null) }, csrf: true },
      },
    },
    {
      label: 'unknown userHandle',
      scenario: {
        fn: 'passkeyDiscoverAction',
        provider: 'singleton',
        request: { url: URL, form: { credential: assertionWith(B64_UNKNOWN) }, csrf: true },
      },
      auditReason: 'unresolved_user',
    },
    {
      label: 'user without a passkey method',
      scenario: {
        fn: 'passkeyDiscoverAction',
        provider: 'singleton',
        request: { url: URL, form: { credential: assertionWith(B64_U1) }, csrf: true },
      },
    },
    {
      label: 'malformed credential JSON (shape violations are non-events)',
      scenario: {
        fn: 'passkeyDiscoverAction',
        provider: 'singleton',
        request: { url: URL, form: { credential: 'not-json{' }, csrf: true },
      },
    },
  ];

  it('collapses every user-dependent failure into the SAME opaque DISCOVERY_FAILED 400, with the real reason only in the audit', () => {
    for (const { label, scenario, auditReason } of OPAQUE_FAILURES) {
      callService(scenario).then((v) => {
        expect(v.response?.status, `${label}: status`).to.equal(400);
        expect(
          (v.response?.dataBody as { error?: string }).error,
          `${label}: opaque body`
        ).to.equal('DISCOVERY_FAILED');
        if (auditReason) {
          expect(
            v.audit?.some(
              (a) =>
                a.event === 'passkey_discover' &&
                a.outcome === 'failure' &&
                (a as { reason?: string }).reason === auditReason
            ),
            `${label}: audited as ${auditReason}`
          ).to.equal(true);
        }
      });
    }
  });

  // Kept out of the table: a DIFFERENT error code. The schema boundary is not
  // user-dependent and is therefore deliberately outside the parity contract.
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

describe('passkey-discover — already signed in as the tapped account', () => {
  // Reachable only since the loader cascade began arming discovery while a session is
  // live. Previously an opaque 400, which read as "something went wrong" when the user
  // had simply tapped the account they were already in.
  it('returns 409 ALREADY_SIGNED_IN with the loginName, not the opaque 400', () => {
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
      expect(v.response?.status).to.equal(409);
      const body = v.response?.dataBody as { error?: string; loginName?: string };
      expect(body.error).to.equal('ALREADY_SIGNED_IN');
      expect(body.loginName).to.equal(PK_USER);
    });
  });
});
