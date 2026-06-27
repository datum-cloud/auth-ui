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

describe('requestPasskeyAttestation — challenge failure audit (graceful degrade, no PII)', () => {
  it('non-ProviderError failure → typed UNKNOWN code, hashed actor, challengeFailed surfaced', () => {
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
  });

  it('typed ProviderError code is recorded with factor=passkey and a hashed actor', () => {
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
  });
});

describe('requestPasskeyAttestation / requestU2FAttestation — provider-sequence parity', () => {
  it('passkey config drives passkeyRegisterLink → registerPasskey, never U2F', () => {
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
  });

  it('security-key config drives registerU2F, never the passkey methods', () => {
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
  });

  it('redirects to /login when no session entry matches the loginName', () => {
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
  });
});

describe('verifyPasskeyEnrollment', () => {
  it("checkAfter='true' routes into /login/passkey threading the raw params", () => {
    callService({
      fn: 'verifyPasskeyEnrollment',
      provider: 'singleton',
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
  });

  it('calls provider.verifyPasskey with (userId, passkeyId, parsedCredential)', () => {
    callService({
      fn: 'verifyPasskeyEnrollment',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/passkey', sessions: sessionsFor() },
      verifyEnrollInput: {
        credential: VALID_CRED,
        passkeyId: 'pk-1',
        loginName: ALICE,
        checkAfter: 'true',
      },
      recordCalls: ['verifyPasskey'],
    }).then((v) => {
      const calls = v.calls?.verifyPasskey ?? [];
      expect(calls).to.have.length(1);
      expect(typeof calls[0][0]).to.equal('string'); // userId
      expect(calls[0][1]).to.equal('pk-1');
      expect(calls[0][2]).to.deep.equal({ id: 'cred-1' });
    });
  });

  it('malformed credential JSON → INVALID_INPUT (no provider call)', () => {
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
  });

  it("INVALID_CREDENTIALS ProviderError → typed error + failure audit factor='passkey'", () => {
    callService({
      fn: 'verifyPasskeyEnrollment',
      provider: 'singleton',
      failVerifyPasskey: 'INVALID_CREDENTIALS',
      request: { url: 'http://localhost/id/setup/passkey', sessions: sessionsFor() },
      verifyEnrollInput: { credential: VALID_CRED, passkeyId: 'pk-1', loginName: ALICE },
    }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, error: 'INVALID_CREDENTIALS' });
      const failure = v.audit.find((e) => e.event === 'mfa_enroll' && e.outcome === 'failure');
      expect(failure?.factor).to.equal('passkey');
    });
  });

  it('unset SESSION_EXPIRED when no matching session entry', () => {
    callService({
      fn: 'verifyPasskeyEnrollment',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/passkey' }, // no sessions
      verifyEnrollInput: { credential: VALID_CRED, passkeyId: 'pk-1', loginName: ALICE },
    }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, error: 'SESSION_EXPIRED' });
    });
  });
});

describe('verifyU2FEnrollment', () => {
  it("checkAfter='true' routes into /login/security-key threading the raw params", () => {
    callService({
      fn: 'verifyU2FEnrollment',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/security-key', sessions: sessionsFor('org-1') },
      verifyEnrollInput: {
        credential: VALID_CRED,
        u2fId: 'u2f-1',
        loginName: ALICE,
        requestId: 'req-9',
        organization: 'org-1',
        checkAfter: 'true',
      },
    }).then((v) => {
      const o = v.outcome as { ok: boolean; target?: string };
      expect(o.ok).to.equal(true);
      expect(o.target ?? '').to.include('/login/security-key?');
      expect(o.target ?? '').to.include('loginName=alice%40acme.test');
      expect(o.target ?? '').to.include('requestId=req-9');
      expect(o.target ?? '').to.include('organization=org-1');
    });
  });

  it('calls provider.verifyU2F with the wrapped credential payload', () => {
    callService({
      fn: 'verifyU2FEnrollment',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/security-key', sessions: sessionsFor() },
      verifyEnrollInput: {
        credential: VALID_CRED,
        u2fId: 'u2f-7',
        loginName: ALICE,
        checkAfter: 'true',
      },
      recordCalls: ['verifyU2F'],
    }).then((v) => {
      const calls = v.calls?.verifyU2F ?? [];
      expect(calls).to.have.length(1);
      expect(typeof calls[0][0]).to.equal('string'); // userId
      expect(calls[0][1]).to.deep.equal({
        u2fId: 'u2f-7',
        publicKeyCredential: { id: 'cred-1' },
        tokenName: '',
      });
    });
  });

  it('malformed credential JSON → INVALID_INPUT (no provider call)', () => {
    callService({
      fn: 'verifyU2FEnrollment',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/security-key', sessions: sessionsFor() },
      verifyEnrollInput: { credential: 'not-json', u2fId: 'u2f-1', loginName: ALICE },
      recordCalls: ['verifyU2F'],
    }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, error: 'INVALID_INPUT' });
      expect(v.calls?.verifyU2F ?? []).to.have.length(0);
    });
  });

  it("INVALID_CREDENTIALS ProviderError → typed error + failure audit factor='u2f'", () => {
    callService({
      fn: 'verifyU2FEnrollment',
      provider: 'singleton',
      failVerifyU2F: 'INVALID_CREDENTIALS',
      request: { url: 'http://localhost/id/setup/security-key', sessions: sessionsFor() },
      verifyEnrollInput: { credential: VALID_CRED, u2fId: 'u2f-1', loginName: ALICE },
    }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, error: 'INVALID_CREDENTIALS' });
      const failure = v.audit.find((e) => e.event === 'mfa_enroll' && e.outcome === 'failure');
      expect(failure?.factor).to.equal('u2f');
    });
  });

  it('unset SESSION_EXPIRED when no matching session entry', () => {
    callService({
      fn: 'verifyU2FEnrollment',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/security-key' }, // no sessions
      verifyEnrollInput: { credential: VALID_CRED, u2fId: 'u2f-1', loginName: ALICE },
    }).then((v) => {
      expect(v.outcome).to.deep.equal({ ok: false, error: 'SESSION_EXPIRED' });
    });
  });
});
