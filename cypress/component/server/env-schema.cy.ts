// cypress/component/server/env-schema.cy.ts
// CY-TASK port of app/utils/env/__tests__/env.server.test.ts
//
// env.server._envSchema is stubbed out of the Vite browser bundle (env = { public:{}, server:{} }).
// The REAL Zod schema validation (security-critical: prod gates, placeholder guard, PUBLIC_ORIGIN
// anti-Host-injection) runs in Bun via cy.task so the stub doesn't apply.
import { callService } from '../../support/node/call-service';

const BASE = {
  SESSION_SECRET: 'test-secret-test-secret-32-chars!!',
  NODE_ENV: 'test',
};

const PROD = {
  SESSION_SECRET: 'test-secret-test-secret-32-chars!!',
  NODE_ENV: 'production',
};

// ── production Zitadel requirements ──────────────────────────────────────────

describe('env schema — production Zitadel requirements (provider-gated)', () => {
  it('requires service token + API URL in production when the provider is zitadel (default)', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: PROD }).then((v) => {
      expect(v.outcome.success).to.equal(false);
    });
  });

  it('requires the service token in production when AUTH_PROVIDER=zitadel explicitly', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...PROD,
        AUTH_PROVIDER: 'zitadel',
        ZITADEL_API_URL: 'https://zitadel.example',
      },
    }).then((v) => {
      // URL present but token missing → still fails
      expect(v.outcome.success).to.equal(false);
    });
  });

  it('passes in production with AUTH_PROVIDER=zitadel + token + URL + PUBLIC_ORIGIN', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...PROD,
        AUTH_PROVIDER: 'zitadel',
        ZITADEL_API_URL: 'https://zitadel.example',
        ZITADEL_SERVICE_USER_TOKEN: 'a-token',
        PUBLIC_ORIGIN: 'https://auth.datum.net',
      },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).PUBLIC_ORIGIN).to.equal(
        'https://auth.datum.net'
      );
    });
  });

  it('accepts and passes through ZITADEL_CUSTOM_REQUEST_HEADERS (optional)', () => {
    const headers = 'x-zitadel-public-host:auth.datum.net,x-zitadel-public-proto:https';
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...PROD,
        AUTH_PROVIDER: 'zitadel',
        ZITADEL_API_URL: 'https://zitadel.example',
        ZITADEL_SERVICE_USER_TOKEN: 'a-token',
        PUBLIC_ORIGIN: 'https://auth.datum.net',
        ZITADEL_CUSTOM_REQUEST_HEADERS: headers,
      },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).ZITADEL_CUSTOM_REQUEST_HEADERS).to.equal(
        headers
      );
    });
  });

  it('does NOT require Zitadel vars in production when AUTH_PROVIDER=fake', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...PROD, AUTH_PROVIDER: 'fake' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
    });
  });
});

// ── PUBLIC_ORIGIN (anti Host-header injection) ────────────────────────────────

describe('env schema — PUBLIC_ORIGIN (verification-link origin; anti Host-header injection)', () => {
  it('FAILS in production (zitadel) when PUBLIC_ORIGIN is missing — fail-closed', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...PROD,
        AUTH_PROVIDER: 'zitadel',
        ZITADEL_API_URL: 'https://zitadel.example',
        ZITADEL_SERVICE_USER_TOKEN: 'a-token',
      },
    }).then((v) => {
      expect(v.outcome.success).to.equal(false);
      expect(
        (v.outcome.issues as Array<{ path: unknown[]; message: string }>).some(
          (i) => i.path[0] === 'PUBLIC_ORIGIN'
        )
      ).to.equal(true);
    });
  });

  it('does NOT require PUBLIC_ORIGIN in production when AUTH_PROVIDER=fake', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...PROD, AUTH_PROVIDER: 'fake' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
    });
  });

  it('accepts absent PUBLIC_ORIGIN outside production (dev/test fall back to request origin)', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: BASE }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).PUBLIC_ORIGIN).to.be.undefined;
    });
  });

  it('rejects a non-URL PUBLIC_ORIGIN', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, PUBLIC_ORIGIN: 'not-a-url' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(false);
    });
  });

  it('FAILS in production (zitadel) when PUBLIC_ORIGIN is still the deployment placeholder', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...PROD,
        AUTH_PROVIDER: 'zitadel',
        ZITADEL_API_URL: 'https://zitadel.example',
        ZITADEL_SERVICE_USER_TOKEN: 'a-token',
        PUBLIC_ORIGIN: 'https://REPLACE_ME.example',
      },
    }).then((v) => {
      expect(v.outcome.success).to.equal(false);
      expect(
        (v.outcome.issues as Array<{ path: unknown[]; message: string }>).some(
          (i) => i.path[0] === 'PUBLIC_ORIGIN'
        )
      ).to.equal(true);
    });
  });

  it('accepts a real http://localhost origin (placeholder guard rejects only REPLACE_ME)', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...PROD,
        AUTH_PROVIDER: 'zitadel',
        ZITADEL_API_URL: 'https://zitadel.example',
        ZITADEL_SERVICE_USER_TOKEN: 'a-token',
        PUBLIC_ORIGIN: 'http://localhost:3000',
      },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).PUBLIC_ORIGIN).to.equal(
        'http://localhost:3000'
      );
    });
  });
});

// ── SENTRY_DSN ────────────────────────────────────────────────────────────────

describe('env schema — SENTRY_DSN', () => {
  it('accepts absent SENTRY_DSN (Sentry disabled)', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: BASE }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).SENTRY_DSN).to.be.undefined;
    });
  });

  it('accepts a valid https DSN', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...BASE,
        SENTRY_DSN: 'https://examplePublicKey@o0.ingest.sentry.io/0',
      },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).SENTRY_DSN).to.equal(
        'https://examplePublicKey@o0.ingest.sentry.io/0'
      );
    });
  });

  it('rejects a non-URL SENTRY_DSN', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, SENTRY_DSN: 'not-a-url' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(false);
    });
  });
});

// ── SENTRY_TRACES_SAMPLE_RATE ─────────────────────────────────────────────────

describe('env schema — SENTRY_TRACES_SAMPLE_RATE', () => {
  it('defaults to 0.1 when SENTRY_TRACES_SAMPLE_RATE is absent', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: BASE }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).SENTRY_TRACES_SAMPLE_RATE).to.equal(0.1);
    });
  });

  it('parses a string "0.5" to the number 0.5', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, SENTRY_TRACES_SAMPLE_RATE: '0.5' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).SENTRY_TRACES_SAMPLE_RATE).to.equal(0.5);
    });
  });

  it('accepts "0" (disable sampling)', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, SENTRY_TRACES_SAMPLE_RATE: '0' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).SENTRY_TRACES_SAMPLE_RATE).to.equal(0);
    });
  });

  it('accepts "1" (sample everything)', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, SENTRY_TRACES_SAMPLE_RATE: '1' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).SENTRY_TRACES_SAMPLE_RATE).to.equal(1);
    });
  });

  it('rejects a value above 1', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, SENTRY_TRACES_SAMPLE_RATE: '1.5' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(false);
    });
  });

  it('rejects a negative value', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, SENTRY_TRACES_SAMPLE_RATE: '-0.1' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(false);
    });
  });

  it('rejects a non-numeric string', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, SENTRY_TRACES_SAMPLE_RATE: 'high' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(false);
    });
  });
});

// ── DEFAULT_APP_URL ───────────────────────────────────────────────────────────

describe('env schema — DEFAULT_APP_URL (optional post-login fallback destination)', () => {
  it('passes through DEFAULT_APP_URL when set to a valid URL', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, DEFAULT_APP_URL: 'http://localhost:3001' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).DEFAULT_APP_URL).to.equal(
        'http://localhost:3001'
      );
    });
  });

  it('leaves DEFAULT_APP_URL undefined when not set', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: BASE }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).DEFAULT_APP_URL).to.be.undefined;
    });
  });
});

// ── FATHOM_ID ─────────────────────────────────────────────────────────────────

describe('env schema — FATHOM_ID (optional analytics site id)', () => {
  it('passes through FATHOM_ID when set', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, FATHOM_ID: 'ABCDEFGH' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).FATHOM_ID).to.equal('ABCDEFGH');
    });
  });

  it('leaves FATHOM_ID undefined when not set', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: BASE }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).FATHOM_ID).to.be.undefined;
    });
  });
});

// ── MAXMIND_ACCOUNT_ID ────────────────────────────────────────────────────────

describe('env schema — MAXMIND_ACCOUNT_ID (optional, device fingerprinting)', () => {
  it('passes through MAXMIND_ACCOUNT_ID when set', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, MAXMIND_ACCOUNT_ID: '123456' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).MAXMIND_ACCOUNT_ID).to.equal('123456');
    });
  });

  it('leaves MAXMIND_ACCOUNT_ID undefined when not set (no-op default)', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: BASE }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      expect((v.outcome.data as Record<string, unknown>).MAXMIND_ACCOUNT_ID).to.be.undefined;
    });
  });
});

// ── ALLOW_IDP_AUTO_LINK (default false; fail-closed) ──────────────────────────
describe('env schema — ALLOW_IDP_AUTO_LINK (default false, fail-closed)', () => {
  it("coerces the exact string 'true' to true", () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, ALLOW_IDP_AUTO_LINK: 'true' },
    }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_AUTO_LINK).to.equal(true);
    });
  });

  it("coerces '1' (not the literal 'true') to false", () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, ALLOW_IDP_AUTO_LINK: '1' },
    }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_AUTO_LINK).to.equal(false);
    });
  });

  it('defaults to false when unset (fail-closed)', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: { ...BASE } }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_AUTO_LINK).to.equal(false);
    });
  });
});

// ── ALLOW_IDP_LINK_ANY_EMAIL (default false, fail-closed; opt-in with 'true') ─────────────
describe('env schema — ALLOW_IDP_LINK_ANY_EMAIL (default false, fail-closed)', () => {
  it('defaults to false when unset (strict POSTURE B2)', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: { ...BASE } }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_LINK_ANY_EMAIL).to.equal(false);
    });
  });

  it("coerces the exact string 'true' to true (enables any-email linking)", () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, ALLOW_IDP_LINK_ANY_EMAIL: 'true' },
    }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_LINK_ANY_EMAIL).to.equal(true);
    });
  });

  it("treats any non-'true' value (e.g. '1') as false (fail-closed)", () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, ALLOW_IDP_LINK_ANY_EMAIL: '1' },
    }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_LINK_ANY_EMAIL).to.equal(false);
    });
  });
});

// ── ALLOW_IDP_UNLINK (default false, fail-closed; opt-in with 'true') ─────────────
describe('env schema — ALLOW_IDP_UNLINK (default false, fail-closed)', () => {
  it('defaults to false when unset', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: { ...BASE } }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_UNLINK).to.equal(false);
    });
  });

  it("coerces the exact string 'true' to true (enables unlink)", () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, ALLOW_IDP_UNLINK: 'true' },
    }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_UNLINK).to.equal(true);
    });
  });

  it("treats any non-'true' value (e.g. '1') as false (fail-closed)", () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, ALLOW_IDP_UNLINK: '1' },
    }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_UNLINK).to.equal(false);
    });
  });
});
