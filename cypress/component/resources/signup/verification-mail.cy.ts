// cypress/component/resources/signup/verification-mail.cy.ts
//
// CY-TASK: sendVerificationMail (app/server/infra/verification-mail.server.ts) opens an outbound
// node:http(s) connection and reads env.server — both unavailable/stubbed in the Vite browser
// bundle — so the REAL client runs node-side via cy.task, same pattern as cypress/component/server/*.
// Each callService() spawns a fresh Bun process (see run-scenario.ts), so env.VERIFICATION_MAIL_URL
// is threaded per-test via `env` and applied BEFORE the client module loads.
//
// Four contracts (task-5-brief.md, Step 1):
//   1. Resolves `false` — never throws — when the endpoint is unreachable.
//   2. Resolves `false` when the endpoint responds non-2xx.
//   3. Posts { userId, code, returnTo } as JSON.
//   4. Never includes the code in a thrown message or a log line.
import { callService } from '../../../support/node/call-service';

const input = (overrides: Partial<{ userId: string; code: string; returnTo: string }> = {}) => ({
  userId: 'user-1',
  code: '123456',
  returnTo: '/dashboard',
  ...overrides,
});

// ── contract 1 ──────────────────────────────────────────────────────────────
describe('sendVerificationMail — unreachable endpoint', () => {
  it('resolves false without throwing when nothing is listening on VERIFICATION_MAIL_URL', () => {
    callService({
      fn: 'sendVerificationMail',
      env: { VERIFICATION_MAIL_URL: 'http://127.0.0.1:58743/webhook' },
      verificationMailInput: input(),
      // verificationMailListen omitted (false) — nothing is listening on that port.
    }).then((v) => {
      // callService() already asserts verdict.ok === true — an uncaught throw would fail here
      // with "runner error: ...". This is the load-bearing "never throws" assertion.
      expect(v.outcome.result, 'must resolve false, not throw').to.equal(false);
    });
  });

  // Every test above (and below) targets an http: URL, which skips postJson's `isHttps` branch
  // entirely — new https.Agent({cert, key, ca}) is never constructed and the TLS error pathway is
  // never invoked. This is the ONLY branch production traffic actually takes (VERIFICATION_MAIL_URL
  // is always deployed as https:), so it needs its own coverage rather than an inference from the
  // http: tests. Nothing listens on the port either, so this stays connection-refused mechanics —
  // no live TLS handshake needed — while still exercising the file-read-per-request path: the
  // *_FILE env vars now point at paths, not PEM content, and nothing is mounted at those paths in
  // this harness, so readFileSync throws synchronously inside postJson's Promise executor. That
  // becomes a promise rejection, which sendVerificationMail's outer try/catch must turn into
  // `false` rather than letting it propagate — this is the direct test of that contract.
  it('resolves false without throwing over https when the client cert/key/CA files do not exist (file-read failure path)', () => {
    callService({
      fn: 'sendVerificationMail',
      env: {
        VERIFICATION_MAIL_URL: 'https://127.0.0.1:58749/webhook',
        VERIFICATION_MAIL_CLIENT_CERT_FILE:
          '/tmp/cy-verification-mail-fixtures/nonexistent-tls.crt',
        VERIFICATION_MAIL_CLIENT_KEY_FILE: '/tmp/cy-verification-mail-fixtures/nonexistent-tls.key',
        VERIFICATION_MAIL_CA_CERT_FILE: '/tmp/cy-verification-mail-fixtures/nonexistent-ca.crt',
      },
      verificationMailInput: input({ userId: 'user-mtls' }),
      // verificationMailListen omitted — nothing listening on that port either.
    }).then((v) => {
      expect(
        v.outcome.result,
        'must resolve false, not throw, even when the cert files cannot be read'
      ).to.equal(false);
    });
  });
});

// ── contract 2 ──────────────────────────────────────────────────────────────
describe('sendVerificationMail — non-2xx response', () => {
  it('resolves false when the endpoint responds 500', () => {
    callService({
      fn: 'sendVerificationMail',
      env: { VERIFICATION_MAIL_URL: 'http://127.0.0.1:58744/webhook' },
      verificationMailInput: input({ userId: 'user-2' }),
      verificationMailListen: true,
      verificationMailStatus: 500,
    }).then((v) => {
      expect(v.outcome.result).to.equal(false);
    });
  });

  it('resolves false when the endpoint responds 404', () => {
    callService({
      fn: 'sendVerificationMail',
      env: { VERIFICATION_MAIL_URL: 'http://127.0.0.1:58745/webhook' },
      verificationMailInput: input({ userId: 'user-3' }),
      verificationMailListen: true,
      verificationMailStatus: 404,
    }).then((v) => {
      expect(v.outcome.result).to.equal(false);
    });
  });
});

// ── contract 3 ──────────────────────────────────────────────────────────────
describe('sendVerificationMail — request shape', () => {
  it('POSTs userId, code and returnTo as JSON, and resolves true on 2xx', () => {
    callService({
      fn: 'sendVerificationMail',
      env: { VERIFICATION_MAIL_URL: 'http://127.0.0.1:58746/webhook' },
      verificationMailInput: { userId: 'user-4', code: 'code-789', returnTo: '/after-verify' },
      verificationMailListen: true,
      verificationMailStatus: 200,
    }).then((v) => {
      expect(v.outcome.result).to.equal(true);
      expect(v.outcome.received.method).to.equal('POST');
      expect(v.outcome.received.contentType).to.contain('application/json');
      expect(v.outcome.received.body).to.deep.equal({
        userId: 'user-4',
        code: 'code-789',
        returnTo: '/after-verify',
      });
    });
  });
});

// ── contract 4 ──────────────────────────────────────────────────────────────
describe('sendVerificationMail — the code is a bearer credential', () => {
  const SECRET_CODE = 'do-not-log-this-code-6f3a9c1e';

  it('never includes the code in a log line when the endpoint is unreachable', () => {
    callService({
      fn: 'sendVerificationMail',
      env: { VERIFICATION_MAIL_URL: 'http://127.0.0.1:58747/webhook' },
      verificationMailInput: input({ code: SECRET_CODE, userId: 'user-5' }),
    }).then((v) => {
      const audit = (v.auditLines ?? []).join('\n');
      expect(v.error ?? '', 'runner error must not carry the code').to.not.contain(SECRET_CODE);
      expect(audit, 'audit log lines must not carry the code').to.not.contain(SECRET_CODE);
      // Positive half of the assertion: a failure MUST actually be audited, so this test can't
      // pass vacuously if audit logging were dropped entirely.
      expect(audit, 'a failure audit line must actually be emitted').to.contain(
        'signup_verification_mail_failed'
      );
    });
  });

  it('never includes the code in a log line when the endpoint responds non-2xx', () => {
    callService({
      fn: 'sendVerificationMail',
      env: { VERIFICATION_MAIL_URL: 'http://127.0.0.1:58748/webhook' },
      verificationMailInput: input({ code: SECRET_CODE, userId: 'user-6' }),
      verificationMailListen: true,
      verificationMailStatus: 500,
    }).then((v) => {
      const audit = (v.auditLines ?? []).join('\n');
      expect(v.error ?? '', 'runner error must not carry the code').to.not.contain(SECRET_CODE);
      expect(audit, 'audit log lines must not carry the code').to.not.contain(SECRET_CODE);
      // Positive half of the assertion: a failure MUST actually be audited, so this test can't
      // pass vacuously if audit logging were dropped entirely.
      expect(audit, 'a failure audit line must actually be emitted').to.contain(
        'signup_verification_mail_failed'
      );
    });
  });
});
