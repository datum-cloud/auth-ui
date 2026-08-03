// cypress/component/resources/webauthn/webauthn.service.cy.ts
//
// cy.task node-spec port of the SESSION-bound webauthn tests:
//   - webauthn.service.test.ts (requestPasskeyAttestation challenge-failure audit;
//     verify{Passkey,U2F}Enrollment parity / INVALID_INPUT / INVALID_CREDENTIALS / SESSION_EXPIRED)
//   - webauthn-enroll.test.ts  (the loader's provider-sequence parity — covered at the SERVICE
//     boundary here via requestPasskeyAttestation/requestU2FAttestation, which is where the
//     passkey-vs-U2F provider divergence actually lives; the loader is a thin shape mapper).
//
// All read an already-read SessionEntry[] and emit REAL audit (logAuthEvent → console.log,
// captured by the harness) against the seeded fake singleton (u1 alice). The browser bundle stubs
// observability + cookie, so these run node-side.
import { callService } from '../../../support/node/call-service';

const ALICE = 'alice@acme.test';
const VALID_CRED = JSON.stringify({ id: 'cred-1' });
const sessionsFor = (organization?: string) => [
  { id: 's1', token: 't1', loginName: ALICE, organization },
];

describe('requestPasskeyAttestation / requestU2FAttestation — challenge audit + provider-sequence parity', () => {
  it('records a failure audit with a hashed actor for provider errors, drives the correct provider methods per config (never crossing passkey/U2F), and redirects to /login with no matching session', () => {
    callService({
      fn: 'requestPasskeyAttestation',
      provider: 'singleton',
      failPasskeyRegisterLink: true, // plain Error
      request: { url: 'http://localhost/id/setup/passkey', sessions: sessionsFor() },
      attestationInput: { loginName: ALICE, domain: 'localhost' },
    }).then((v) => {
      // degrades gracefully — no throw, publicKey null, challengeFailed true.
      const o = v.outcome as {
        kind: string;
        challengeFailed?: boolean;
        publicKeyCredentialCreationOptions?: unknown;
      };
      expect(o.kind).to.equal('challenge');
      expect(o.challengeFailed).to.equal(true);
      expect(o.publicKeyCredentialCreationOptions).to.equal(null);

      const failure = v.audit.find(
        (e) => e.event === 'mfa_enroll_challenge' && e.outcome === 'failure'
      );
      expect(failure, 'a failure audit event').to.not.equal(undefined);
      expect(failure?.code).to.equal('UNKNOWN');
      expect(failure?.loginName, 'no raw loginName').to.equal(undefined);
      expect(typeof failure?.actor).to.equal('string');
      expect(failure?.actor).to.not.equal(ALICE); // pseudonymized
    });

    callService({
      fn: 'requestPasskeyAttestation',
      provider: 'singleton',
      passkeyRegisterLinkError: 'UNAVAILABLE',
      request: { url: 'http://localhost/id/setup/passkey', sessions: sessionsFor() },
      attestationInput: { loginName: ALICE, domain: 'localhost' },
    }).then((v) => {
      const o = v.outcome as { kind: string; challengeFailed?: boolean };
      expect(o.kind).to.equal('challenge');
      expect(o.challengeFailed).to.equal(true);
      const failure = v.audit.find(
        (e) => e.event === 'mfa_enroll_challenge' && e.outcome === 'failure'
      );
      expect(failure?.code).to.equal('UNAVAILABLE');
      expect(failure?.factor).to.equal('passkey');
      expect(typeof failure?.actor).to.equal('string');
      expect(failure?.actor).to.not.equal(ALICE);
      expect(failure?.loginName).to.equal(undefined);
    });

    callService({
      fn: 'requestPasskeyAttestation',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/passkey', sessions: sessionsFor() },
      attestationInput: { loginName: ALICE, domain: 'localhost' },
      recordCalls: ['passkeyRegisterLink', 'registerPasskey', 'registerU2F'],
    }).then((v) => {
      expect(v.calls?.passkeyRegisterLink ?? []).to.have.length(1);
      expect(v.calls?.registerPasskey ?? []).to.have.length(1);
      expect(v.calls?.registerU2F ?? []).to.have.length(0);
      const o = v.outcome as { kind: string; passkeyId?: string; challengeFailed?: boolean };
      expect(o.kind).to.equal('challenge');
      expect(typeof o.passkeyId).to.equal('string');
      expect(o.challengeFailed).to.equal(false);
    });

    callService({
      fn: 'requestU2FAttestation',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/security-key', sessions: sessionsFor() },
      attestationInput: { loginName: ALICE, domain: 'localhost' },
      recordCalls: ['passkeyRegisterLink', 'registerPasskey', 'registerU2F'],
    }).then((v) => {
      expect(v.calls?.registerU2F ?? []).to.have.length(1);
      expect(v.calls?.passkeyRegisterLink ?? []).to.have.length(0);
      expect(v.calls?.registerPasskey ?? []).to.have.length(0);
      const o = v.outcome as { kind: string; u2fId?: string };
      expect(o.kind).to.equal('challenge');
      expect(typeof o.u2fId).to.equal('string');
      // U2F challenge result carries NO challengeFailed field (passkey-only divergence).
      expect(o).to.not.have.property('challengeFailed');
    });

    callService({
      fn: 'requestPasskeyAttestation',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/passkey' }, // no sessions
      attestationInput: { loginName: 'ghost@nowhere.test', domain: 'localhost' },
    }).then((v) => {
      const o = v.outcome as { kind: string; target?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.target).to.equal('/login');
    });

    // Regression: the guard-fail redirect must thread requestId/organization when present —
    // a dead session mid-OIDC/SAML/device ceremony must be able to resume after re-login.
    callService({
      fn: 'requestPasskeyAttestation',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/passkey' }, // no sessions
      attestationInput: {
        loginName: 'ghost@nowhere.test',
        domain: 'localhost',
        requestId: 'oidc_V2_123',
        organization: 'org-1',
      },
    }).then((v) => {
      const o = v.outcome as { kind: string; target?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.target).to.equal('/login?requestId=oidc_V2_123&organization=org-1');
    });

    callService({
      fn: 'requestU2FAttestation',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/security-key' }, // no sessions
      attestationInput: {
        loginName: 'ghost@nowhere.test',
        domain: 'localhost',
        requestId: 'oidc_V2_456',
      },
    }).then((v) => {
      const o = v.outcome as { kind: string; target?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.target).to.equal('/login?requestId=oidc_V2_456');
    });
  });
});

describe('requestWebAuthnChallenge — guard-fail bounce target threading', () => {
  // Same call, same assertion shape — only the ceremony context and expected target vary.
  const BOUNCES: [label: string, ceremony: Record<string, string>, expectedTarget: string][] = [
    [
      // Mirrors the attestation siblings: a dead session mid-ceremony must resume after re-login.
      'requestId + organization',
      { requestId: 'oidc_V2_789', organization: 'org-1' },
      '/login?requestId=oidc_V2_789&organization=org-1',
    ],
    ['no ceremony context', {}, '/login'],
  ];

  it('bounces to /login when there is no matching session, threading requestId + organization when present and bare otherwise', () => {
    for (const [label, ceremony, expectedTarget] of BOUNCES) {
      callService({
        fn: 'requestWebAuthnChallenge',
        provider: 'singleton',
        request: { url: 'http://localhost/id/login/passkey' }, // no sessions
        attestationInput: {
          loginName: 'ghost@nowhere.test',
          domain: 'localhost',
          ...ceremony,
        },
      }).then((v) => {
        const o = v.outcome as { kind: string; target?: string };
        expect(o.kind, `${label}: redirect`).to.equal('redirect');
        expect(o.target, `${label}: target`).to.equal(expectedTarget);
      });
    }
  });
});

// Singleton seed: u5 passkey-user@acme.test carries a passkey (same constant as
// routes/login/conditional-passkey-loader.cy.ts).
const PK_USER = 'passkey-user@acme.test';

describe('requestWebAuthnChallenge — stale provider-side session self-heal', () => {
  // Staging bug: after an OIDC logout the signed `sessions` cookie survived with a
  // still-future expirationTs while Zitadel had already terminated the session. byLoginName
  // therefore handed a DEAD entry to updateSession, which threw NOT_FOUND/PERMISSION_DENIED.
  // The bare `catch {}` swallowed it and returned a null challenge, so the screen rendered
  // normally and WebAuthnButton's `!publicKey` guard fired on click — surfacing
  // "The passkey verification failed. Please try again." without ever calling
  // navigator.credentials.get(). Nothing was verified; the advice to retry could never work.
  it('re-mints a user-bound session and arms a fresh challenge when the cookie entry is dead provider-side', () => {
    callService({
      fn: 'requestWebAuthnChallenge',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login/passkey',
        // Names a REAL seeded passkey user, but an id/token the provider has never issued —
        // the fake throws ProviderError('NOT_FOUND') exactly as staging Zitadel does.
        sessions: [{ id: 'dead-session', token: 'dead-token', loginName: PK_USER }],
      },
      attestationInput: { loginName: PK_USER, domain: 'localhost' },
    }).then((v) => {
      const o = v.outcome as {
        kind: string;
        publicKeyCredentialRequestOptions?: unknown;
        setCookies?: string[];
      };
      expect(o.kind).to.equal('challenge');
      expect(o.publicKeyCredentialRequestOptions, 'a fresh challenge is armed').to.exist;
      // The dead entry must be superseded so the cookie stops advertising it as live.
      expect(
        (o.setCookies ?? []).some((c) => c.startsWith('sessions=')),
        'sessions Set-Cookie'
      ).to.be.true;
    });
  });

  it('bounces to /login when the session is dead AND the user no longer resolves', () => {
    callService({
      fn: 'requestWebAuthnChallenge',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login/passkey',
        sessions: [{ id: 'dead-session', token: 'dead-token', loginName: 'ghost@acme.test' }],
      },
      attestationInput: {
        loginName: 'ghost@acme.test',
        domain: 'localhost',
        requestId: 'oidc_V2_1',
      },
    }).then((v) => {
      const o = v.outcome as { kind: string; target?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.target).to.equal('/login?requestId=oidc_V2_1');
    });
  });
});

describe('verifyPasskeyEnrollment', () => {
  it('threads checkAfter routing params, rejects malformed/invalid credentials, and expires with no session', () => {
    callService({
      fn: 'verifyPasskeyEnrollment',
      provider: 'singleton',
      // The sudo gate reads the ACTIVE session's factors — seed s1 live (the
      // singleton stamps REAL factor timestamps, so the 10-min window passes).
      liveSessions: [{ id: 's1', token: 't1' }],
      request: { url: 'http://localhost/id/setup/passkey', sessions: sessionsFor('org-1') },
      verifyEnrollInput: {
        credential: VALID_CRED,
        passkeyId: 'pk-1',
        loginName: ALICE,
        requestId: 'req-9',
        organization: 'org-1',
        checkAfter: 'true',
      },
    }).then((v) => {
      const o = v.outcome as { ok: boolean; target?: string };
      expect(o.ok).to.equal(true);
      expect(o.target ?? '').to.include('/login/passkey?');
      expect(o.target ?? '').to.include('loginName=alice%40acme.test');
      expect(o.target ?? '').to.include('requestId=req-9');
      expect(o.target ?? '').to.include('organization=org-1');
    });

    callService({
      fn: 'verifyPasskeyEnrollment',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/passkey', sessions: sessionsFor() },
      verifyEnrollInput: { credential: 'not-json', passkeyId: 'pk-1', loginName: ALICE },
      recordCalls: ['verifyPasskey'],
    }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, error: 'INVALID_INPUT' });
      expect(v.calls?.verifyPasskey ?? []).to.have.length(0);
    });

    callService({
      fn: 'verifyPasskeyEnrollment',
      provider: 'singleton',
      failVerifyPasskey: 'INVALID_CREDENTIALS',
      // Seed the live session so the sudo gate passes and the scenario still
      // exercises the INVALID_CREDENTIALS mapping.
      liveSessions: [{ id: 's1', token: 't1' }],
      request: { url: 'http://localhost/id/setup/passkey', sessions: sessionsFor() },
      verifyEnrollInput: { credential: VALID_CRED, passkeyId: 'pk-1', loginName: ALICE },
    }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, error: 'INVALID_CREDENTIALS' });
      const failure = v.audit.find((e) => e.event === 'mfa_enroll' && e.outcome === 'failure');
      expect(failure?.factor).to.equal('passkey');
    });

    callService({
      fn: 'verifyPasskeyEnrollment',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/passkey' }, // no sessions
      verifyEnrollInput: { credential: VALID_CRED, passkeyId: 'pk-1', loginName: ALICE },
    }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, error: 'SESSION_EXPIRED' });
    });

    // A stored session token from a different browser/tab can be stale or revoked
    // provider-side by the time this route sees it — the real Zitadel backend throws a
    // non-transient ProviderError (e.g. PERMISSION_DENIED) from the sudo gate's own
    // getSession call instead of returning null. Recovers to SESSION_EXPIRED, not a crash
    // (mirrors passkeys.service.ts/reauth.service.ts's own stale-session fix).
    callService({
      fn: 'verifyPasskeyEnrollment',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1' }],
      sessionResults: { s1: { mode: 'throw', code: 'PERMISSION_DENIED' } },
      request: { url: 'http://localhost/id/setup/passkey', sessions: sessionsFor() },
      verifyEnrollInput: { credential: VALID_CRED, passkeyId: 'pk-1', loginName: ALICE },
    }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, error: 'SESSION_EXPIRED' });
    });
  });
});
