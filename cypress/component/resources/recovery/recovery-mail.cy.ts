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
// Four contracts, mirroring verification-mail.cy.ts:
//   1. Unreachable endpoint resolves false — never throws (requestRecovery's G7 exit depends on it).
//   2. Non-2xx resolves false.
//   3. 2xx resolves true and posts { userId, codeId, code, returnTo, requestedBy } as JSON.
//   4. The `code` never reaches a log line; `codeId` may.
import { callService } from '../../../support/node/call-service';

const PORT_BASE = 58760;
const url = (port: number, path: string) => `http://127.0.0.1:${port}${path}`;

const envFor = (port: number) => ({
  VERIFICATION_MAIL_URL: url(port, '/v1/email/verification'),
  RECOVERY_MAIL_URL: url(port, '/v1/email/recovery'),
});

const input = (
  overrides: Partial<{
    userId: string;
    codeId: string;
    code: string;
    returnTo: string;
    requestedBy: 'self';
  }> = {}
) => ({
  userId: 'user-1',
  codeId: 'code-id-1',
  code: 'ABC123XY',
  returnTo: 'http://localhost/id/recover/complete',
  requestedBy: 'self' as const,
  ...overrides,
});

// ── contract 1 ──────────────────────────────────────────────────────────────
describe('sendRecoveryMail — unreachable endpoint', () => {
  it('resolves false without throwing when nothing is listening on RECOVERY_MAIL_URL', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: envFor(PORT_BASE),
      recoveryMailInput: input(),
    }).then((v) => {
      // callService() already asserts verdict.ok — an uncaught throw fails here as "runner error".
      // This is the load-bearing "never throws" assertion: requestRecovery's G7 exit calls this
      // without a try/catch of its own around the send.
      expect(v.outcome.result, 'must resolve false, not throw').to.equal(false);
    });
  });

  it('resolves false when RECOVERY_MAIL_URL is unset, with no audit line at all', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: { VERIFICATION_MAIL_URL: url(PORT_BASE + 1, '/v1/email/verification') },
      recoveryMailInput: input({ userId: 'user-unset' }),
    }).then((v) => {
      expect(v.outcome.result).to.equal(false);
      const audit = (v.auditLines ?? []).join('\n');
      expect(audit, 'delivery disabled is silent, not a failure').to.not.contain('recovery_mail_');
    });
  });
});

// ── contract 2 ──────────────────────────────────────────────────────────────
describe('sendRecoveryMail — non-2xx response', () => {
  it('resolves false and audits recovery_mail_failed when the endpoint responds 500', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: envFor(PORT_BASE + 2),
      recoveryMailInput: input({ userId: 'user-500' }),
      verificationMailListen: true,
      verificationMailStatus: 500,
    }).then((v) => {
      expect(v.outcome.result).to.equal(false);
      const audit = (v.auditLines ?? []).join('\n');
      expect(audit).to.contain('recovery_mail_failed');
      expect(audit).to.not.contain('recovery_mail_sent');
    });
  });
});

// ── contract 3 ──────────────────────────────────────────────────────────────
describe('sendRecoveryMail — request shape', () => {
  it('POSTs the recovery payload as JSON to the recovery path and resolves true on 2xx', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: envFor(PORT_BASE + 3),
      recoveryMailInput: {
        userId: 'user-4',
        codeId: 'code-id-4',
        code: 'ZZ99XX11',
        returnTo: 'http://localhost/id/recover/complete?organization=org-1',
        requestedBy: 'self',
      },
      verificationMailListen: true,
      verificationMailStatus: 200,
    }).then((v) => {
      expect(v.outcome.result).to.equal(true);
      expect(v.outcome.received.method).to.equal('POST');
      expect(v.outcome.received.contentType).to.contain('application/json');
      // Distinguishes the recovery webhook from the verification one on the shared listener.
      expect(v.outcome.received.path).to.equal('/v1/email/recovery');
      expect(v.outcome.received.body).to.deep.equal({
        userId: 'user-4',
        codeId: 'code-id-4',
        code: 'ZZ99XX11',
        returnTo: 'http://localhost/id/recover/complete?organization=org-1',
        requestedBy: 'self',
      });
      const audit = (v.auditLines ?? []).join('\n');
      expect(audit).to.contain('recovery_mail_sent');
    });
  });
});

// ── contract 4 ──────────────────────────────────────────────────────────────
describe('sendRecoveryMail — the code is a bearer credential', () => {
  const SECRET_CODE = 'do-not-log-this-code-6f3a9c1e';

  it('never logs the code when the endpoint is unreachable, but does audit the failure', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: envFor(PORT_BASE + 4),
      recoveryMailInput: input({ code: SECRET_CODE, userId: 'user-5' }),
    }).then((v) => {
      const audit = (v.auditLines ?? []).join('\n');
      expect(v.error ?? '', 'runner error must not carry the code').to.not.contain(SECRET_CODE);
      expect(audit, 'audit log lines must not carry the code').to.not.contain(SECRET_CODE);
      // Positive half: a failure MUST be audited, so this cannot pass vacuously.
      expect(audit, 'a failure audit line must actually be emitted').to.contain(
        'recovery_mail_failed'
      );
    });
  });

  it('never logs the code on a non-2xx response either', () => {
    callService({
      fn: 'sendRecoveryMail',
      env: envFor(PORT_BASE + 5),
      recoveryMailInput: input({ code: SECRET_CODE, userId: 'user-6' }),
      verificationMailListen: true,
      verificationMailStatus: 500,
    }).then((v) => {
      const audit = (v.auditLines ?? []).join('\n');
      expect(v.error ?? '', 'runner error must not carry the code').to.not.contain(SECRET_CODE);
      expect(audit, 'audit log lines must not carry the code').to.not.contain(SECRET_CODE);
      expect(audit).to.contain('recovery_mail_failed');
    });
  });
});
