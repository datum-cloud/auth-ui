// cypress/component/resources/recovery/recovery-mail.cy.ts
//
// CY-TASK: sendRecoveryMail (app/server/infra/recovery-mail.server.ts) opens an outbound
// node:http(s) connection and reads env.server, so the REAL client runs node-side via cy.task,
// mirroring verification-mail.cy.ts. Each callService() spawns a fresh Bun process, so both mail
// URLs are threaded per-test via `env` and applied BEFORE the client module loads.
//
// Both URLs point at the SAME listener port with DIFFERENT paths, which is how the shared
// harness listener captures the recovery POST and how the path assertion below has meaning.
//
// CONTRACT v2 (zitadel-provider #138): the webhook MINTS the code. The request carries only
// { userId, returnTo, requestedBy } — sending `codeId`/`code` is a 400 — and the 200 answers
// { codeId }. So this client now has a RETURN VALUE (the codeId, or null) rather than a boolean,
// and the raw code never passes through auth-ui at all.
//
// Five contracts:
//   1. Unreachable endpoint resolves null — never throws (requestRecovery's G7 exit depends on it).
//   2. Non-2xx resolves null.
//   3. 2xx + { codeId } resolves that codeId and posts { userId, returnTo, requestedBy } as JSON.
//   4. A 200 whose body is malformed resolves null rather than throwing.
//   5. The response body never reaches a log line; `codeId` may.
import { callService } from '../../../support/node/call-service';

const PORT_BASE = 58760;
const url = (port: number, path: string) => `http://127.0.0.1:${port}${path}`;

const envFor = (port: number) => ({
  VERIFICATION_MAIL_URL: url(port, '/v1/email/verification'),
  RECOVERY_MAIL_URL: url(port, '/v1/email/recovery'),
});

const input = (
  overrides: Partial<{ userId: string; returnTo: string; requestedBy: 'self' }> = {}
) => ({
  userId: 'user-1',
  returnTo: 'http://localhost/id/recover/complete',
  requestedBy: 'self' as const,
  ...overrides,
});

// ── contract 1 ──────────────────────────────────────────────────────────────
describe('sendRecoveryMail — unreachable endpoint', () => {
  it('resolves null without throwing when nothing is listening on RECOVERY_MAIL_URL', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: envFor(PORT_BASE),
      recoveryMailInput: input(),
    }).then((v) => {
      // callService() already asserts verdict.ok — an uncaught throw fails here as "runner error".
      // This is the load-bearing "never throws" assertion: requestRecovery's G7 exit calls this
      // without a try/catch of its own around the send.
      expect(v.outcome.result, 'must resolve null, not throw').to.equal(null);
    });
  });

  it('resolves null when RECOVERY_MAIL_URL is unset, with no audit line at all', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: { VERIFICATION_MAIL_URL: url(PORT_BASE + 1, '/v1/email/verification') },
      recoveryMailInput: input({ userId: 'user-unset' }),
    }).then((v) => {
      expect(v.outcome.result).to.equal(null);
      const audit = (v.auditLines ?? []).join('\n');
      expect(audit, 'delivery disabled is silent, not a failure').to.not.contain('recovery_mail_');
    });
  });
});

// ── contract 2 ──────────────────────────────────────────────────────────────
describe('sendRecoveryMail — non-2xx response', () => {
  it('resolves null and audits recovery_mail_failed when the endpoint responds 500', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: envFor(PORT_BASE + 2),
      recoveryMailInput: input({ userId: 'user-500' }),
      verificationMailListen: true,
      verificationMailStatus: 500,
      // A 500 that still carried a codeId-shaped body must not be mistaken for a success: the
      // STATUS decides, and only then is the body read.
      verificationMailResponseBody: { codeId: 'must-not-be-used' },
    }).then((v) => {
      expect(v.outcome.result).to.equal(null);
      const audit = (v.auditLines ?? []).join('\n');
      expect(audit).to.contain('recovery_mail_failed');
      expect(audit).to.not.contain('recovery_mail_sent');
      expect(audit, 'a refused status must not adopt its body').to.not.contain('must-not-be-used');
    });
  });

  it('resolves null on a 429 — the webhook per-user cooldown', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: envFor(PORT_BASE + 6),
      recoveryMailInput: input({ userId: 'user-429' }),
      verificationMailListen: true,
      verificationMailStatus: 429,
    }).then((v) => {
      expect(v.outcome.result).to.equal(null);
      expect((v.auditLines ?? []).join('\n')).to.contain('recovery_mail_failed');
    });
  });
});

// ── contract 3 ──────────────────────────────────────────────────────────────
describe('sendRecoveryMail — request shape', () => {
  it('POSTs only { userId, returnTo, requestedBy } and returns the minted codeId', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: envFor(PORT_BASE + 3),
      recoveryMailInput: {
        userId: 'user-4',
        returnTo: 'http://localhost/id/recover/complete?organization=org-1',
        requestedBy: 'self',
      },
      verificationMailListen: true,
      verificationMailStatus: 200,
      verificationMailResponseBody: { codeId: 'minted-code-id-4' },
    }).then((v) => {
      expect(v.outcome.result, 'the codeId the webhook minted').to.equal('minted-code-id-4');
      expect(v.outcome.received.method).to.equal('POST');
      expect(v.outcome.received.contentType).to.contain('application/json');
      // Distinguishes the recovery webhook from the verification one on the shared listener.
      expect(v.outcome.received.path).to.equal('/v1/email/recovery');
      // deep.equal, not a subset check: `codeId`/`code` in this body is a 400 from the webhook
      // (the caller no longer mints), so their ABSENCE is the contract, not an accident.
      expect(v.outcome.received.body).to.deep.equal({
        userId: 'user-4',
        returnTo: 'http://localhost/id/recover/complete?organization=org-1',
        requestedBy: 'self',
      });
      const audit = (v.auditLines ?? []).join('\n');
      expect(audit).to.contain('recovery_mail_sent');
    });
  });
});

// ── contract 4 ──────────────────────────────────────────────────────────────
describe('sendRecoveryMail — a 200 the client cannot use', () => {
  // Each row is a 200 whose body does not name a usable codeId. All of them must resolve null
  // rather than throw or return a junk value that would then be sealed into a ticket.
  const rows: Array<[name: string, body: unknown]> = [
    ['an empty object', {}],
    ['a null codeId', { codeId: null }],
    ['an empty codeId', { codeId: '' }],
    ['a non-string codeId', { codeId: 42 }],
    ['a JSON array', ['codeId']],
    ['a JSON string', 'codeId'],
  ];

  for (const [name, body] of rows) {
    it(`resolves null for ${name}`, () => {
      callService({
        fn: 'sendRecoveryMail',
        env: envFor(PORT_BASE + 7),
        recoveryMailInput: input({ userId: 'user-malformed' }),
        verificationMailListen: true,
        verificationMailStatus: 200,
        verificationMailResponseBody: body,
      }).then((v) => {
        expect(v.outcome.result, 'a 200 without a usable codeId is a failure').to.equal(null);
        expect((v.auditLines ?? []).join('\n')).to.contain('recovery_mail_failed');
      });
    });
  }
});

// ── contract 5 ──────────────────────────────────────────────────────────────
describe('sendRecoveryMail — the response body is never logged', () => {
  const SECRET = 'do-not-log-this-body-6f3a9c1e';

  it('never logs a 200 body it could not parse', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: envFor(PORT_BASE + 8),
      recoveryMailInput: input({ userId: 'user-5' }),
      verificationMailListen: true,
      verificationMailStatus: 200,
      // The webhook must never return the raw code, but a misconfigured or compromised one could.
      // Whatever it sends back must not be echoed into the audit log.
      verificationMailResponseBody: { code: SECRET },
    }).then((v) => {
      const audit = (v.auditLines ?? []).join('\n');
      expect(v.error ?? '', 'runner error must not carry the body').to.not.contain(SECRET);
      expect(audit, 'audit log lines must not carry the body').to.not.contain(SECRET);
      // Positive half: a failure MUST be audited, so this cannot pass vacuously.
      expect(audit, 'a failure audit line must actually be emitted').to.contain(
        'recovery_mail_failed'
      );
    });
  });

  it('never logs a non-2xx body either', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: envFor(PORT_BASE + 5),
      recoveryMailInput: input({ userId: 'user-6' }),
      verificationMailListen: true,
      verificationMailStatus: 500,
      verificationMailResponseBody: { detail: SECRET },
    }).then((v) => {
      const audit = (v.auditLines ?? []).join('\n');
      expect(v.error ?? '', 'runner error must not carry the body').to.not.contain(SECRET);
      expect(audit, 'audit log lines must not carry the body').to.not.contain(SECRET);
      expect(audit).to.contain('recovery_mail_failed');
    });
  });
});
