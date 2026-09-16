// cypress/component/server/env-recovery.cy.ts
// Phase C Lane D · Task 1 — AUTH_ACCOUNT_RECOVERY_ENABLED and RECOVERY_MAIL_URL.
//
// The flag is fail-safe OFF and the mail URL carries the same half-configured-mTLS guard
// VERIFICATION_MAIL_URL has: an https target without the client cert material would fail every
// call SILENTLY at runtime (recovery-mail.server.ts never throws), so boot must refuse it.
// Runs the REAL Zod schema in Bun via cy.task — env.server is stubbed in the browser bundle.
import { callService } from '../../support/node/call-service';

const BASE = {
  SESSION_SECRET: 'test-secret-test-secret-32-chars!!',
  NODE_ENV: 'test',
};

describe('env schema — account recovery', () => {
  it('defaults AUTH_ACCOUNT_RECOVERY_ENABLED to false when unset', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: BASE }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).AUTH_ACCOUNT_RECOVERY_ENABLED).to.equal(
        false
      );
    });
  });

  it("enables the flag only for the explicit 'true'/'1' strings", () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, AUTH_ACCOUNT_RECOVERY_ENABLED: 'true' },
    }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).AUTH_ACCOUNT_RECOVERY_ENABLED).to.equal(
        true
      );
    });
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, AUTH_ACCOUNT_RECOVERY_ENABLED: 'yes' },
    }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).AUTH_ACCOUNT_RECOVERY_ENABLED).to.equal(
        false
      );
    });
  });

  it('FAILS boot when RECOVERY_MAIL_URL is https but the mTLS client files are not all set', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...BASE,
        AUTH_ACCOUNT_RECOVERY_ENABLED: 'true',
        RECOVERY_MAIL_URL: 'https://hook.test/v1/email/recovery',
      },
    }).then((v) => {
      expect(v.outcome.success, 'https without cert files must fail boot').to.equal(false);
      const issues = v.outcome.issues as Array<{ path: unknown[]; message: string }>;
      expect(issues.some((i) => i.path[0] === 'RECOVERY_MAIL_URL')).to.equal(true);
    });
  });

  it('accepts an https RECOVERY_MAIL_URL once all three VERIFICATION_MAIL_* files are set', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...BASE,
        AUTH_ACCOUNT_RECOVERY_ENABLED: 'true',
        RECOVERY_MAIL_URL: 'https://hook.test/v1/email/recovery',
        VERIFICATION_MAIL_CLIENT_CERT_FILE: '/certs/tls.crt',
        VERIFICATION_MAIL_CLIENT_KEY_FILE: '/certs/tls.key',
        VERIFICATION_MAIL_CA_CERT_FILE: '/certs/ca.crt',
      },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).RECOVERY_MAIL_URL).to.equal(
        'https://hook.test/v1/email/recovery'
      );
    });
  });

  it('leaves an http RECOVERY_MAIL_URL (node-spec harness only) inert without cert files', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, RECOVERY_MAIL_URL: 'http://127.0.0.1:1/v1/email/recovery' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
    });
  });
});
