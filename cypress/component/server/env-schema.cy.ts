// cypress/component/server/env-schema.cy.ts
// CY-TASK port of app/utils/env/__tests__/env.server.test.ts
//
// env.server._envSchema is stubbed out of the Vite browser bundle (env = { public:{}, server:{} }).
// The REAL Zod schema validation (security-critical: prod gates, placeholder guard, PUBLIC_ORIGIN
// anti-Host-injection) runs in Bun via cy.task so the stub doesn't apply.
//
// NOTE: This suite was deliberately reduced from a 36-test matrix (one it() per env var /
// permutation) down to a small representative set. These are enumeration/matrix tests, not
// security-protected regression tests — each surviving test stands in for a whole class of
// identical-mechanism cases (see inline comments).
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
// Two tests together prove the prod gate fails-closed by default and succeeds
// once correctly configured.

describe('env schema — production Zitadel requirements (provider-gated)', () => {
  it('requires service token + API URL in production when the provider is zitadel (default)', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: PROD }).then((v) => {
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
});

// ── PUBLIC_ORIGIN (anti Host-header injection) ────────────────────────────────
// Representative test for the anti-Host-header-injection guard: rejecting the
// deployment placeholder is the most load-bearing case (unique security logic,
// not just a requiredness check already covered by the prod-gate tests above).

describe('env schema — PUBLIC_ORIGIN (verification-link origin; anti Host-header injection)', () => {
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
});

// ── AUTH_EMAIL_VERIFICATION_REQUIRED (INVERSE polarity: default true, fail-closed) ─────────────
// Phase B promotes this out of a raw process.env read (app/server/env.ts) AND reverses its
// default. It deliberately does NOT mirror AUTH_EMAIL_DELIVERY_ENABLED: delivery is
// permissive-off, this is fail-closed-on, because verification-off makes signup pass
// emailVerified:true and mint accounts on addresses nobody proved they own. Polarity here
// matches AUTH_PASSKEY_DISCOVERY_ENABLED, the repo's other inverse flag.
//
// EMAIL_VERIFICATION is the deprecated old name for this same flag, still honoured as an alias
// (see the resolution in env.server.ts's final .transform()) so a deployment that hasn't
// migrated doesn't silently flip to verification-ON and dead-end every signup.

const readWarnings = (v: { outcome: Record<string, unknown> }) => v.outcome.warnings as string[];
const DEPRECATION_WARNING =
  '[env] EMAIL_VERIFICATION is deprecated; rename it to AUTH_EMAIL_VERIFICATION_REQUIRED (same values, same meaning)';

describe('env schema — AUTH_EMAIL_VERIFICATION_REQUIRED (fail-closed, default true)', () => {
  it("defaults to true when unset, and only an explicit 'false'/'0' disables it", () => {
    // The security-critical case: a MISSING var must not silently skip verification.
    callService({ fn: 'envSchemaFull', parseEnvRaw: { ...BASE } }).then((v) => {
      expect(
        (v.outcome.data as Record<string, unknown>).AUTH_EMAIL_VERIFICATION_REQUIRED,
        'unset must FAIL CLOSED to required'
      ).to.equal(true);
    });

    for (const raw of ['false', '0']) {
      callService({
        fn: 'envSchemaFull',
        parseEnvRaw: { ...BASE, AUTH_EMAIL_VERIFICATION_REQUIRED: raw },
      }).then((v) => {
        expect(
          (v.outcome.data as Record<string, unknown>).AUTH_EMAIL_VERIFICATION_REQUIRED,
          `explicit '${raw}' opts out`
        ).to.equal(false);
      });
    }

    // 'true' is the explicit affirmative — must stay required.
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, AUTH_EMAIL_VERIFICATION_REQUIRED: 'true' },
    }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).AUTH_EMAIL_VERIFICATION_REQUIRED).to.equal(
        true
      );
    });
  });

  it('honours the deprecated EMAIL_VERIFICATION alias when the new name is unset', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, EMAIL_VERIFICATION: 'false' },
    }).then((v) => {
      expect(
        (v.outcome.data as Record<string, unknown>).AUTH_EMAIL_VERIFICATION_REQUIRED,
        'alias must resolve the same as the new name'
      ).to.equal(false);
    });
  });

  it('prefers AUTH_EMAIL_VERIFICATION_REQUIRED over EMAIL_VERIFICATION when both are set', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...BASE,
        AUTH_EMAIL_VERIFICATION_REQUIRED: 'true',
        EMAIL_VERIFICATION: 'false',
      },
    }).then((v) => {
      expect(
        (v.outcome.data as Record<string, unknown>).AUTH_EMAIL_VERIFICATION_REQUIRED,
        'new name wins'
      ).to.equal(true);
    });
  });

  it('warns exactly when only the deprecated EMAIL_VERIFICATION name is set', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, EMAIL_VERIFICATION: 'false' },
    }).then((v) => {
      expect(readWarnings(v), 'old name alone must warn').to.include(DEPRECATION_WARNING);
    });

    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, AUTH_EMAIL_VERIFICATION_REQUIRED: 'true' },
    }).then((v) => {
      expect(readWarnings(v), 'new name set alone must not warn').to.deep.equal([]);
    });

    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...BASE,
        AUTH_EMAIL_VERIFICATION_REQUIRED: 'true',
        EMAIL_VERIFICATION: 'false',
      },
    }).then((v) => {
      expect(readWarnings(v), 'new name set alongside the alias must not warn').to.deep.equal([]);
    });

    callService({ fn: 'envSchemaFull', parseEnvRaw: { ...BASE } }).then((v) => {
      expect(readWarnings(v), 'neither set must not warn').to.deep.equal([]);
    });
  });
});

// ── SENTRY_TRACES_SAMPLE_RATE ─────────────────────────────────────────────────
// Representative "invalid type is rejected" case for numeric coercion/validation.

describe('env schema — SENTRY_TRACES_SAMPLE_RATE', () => {
  it('rejects a non-numeric string', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, SENTRY_TRACES_SAMPLE_RATE: 'high' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(false);
    });
  });
});

// ── ALLOW_IDP_LINK_ANY_EMAIL (default false, fail-closed) ─────────────────────
// Representative of the identical fail-closed boolean-flag mechanism shared by
// ALLOW_IDP_AUTO_LINK / ALLOW_IDP_LINK_ANY_EMAIL / ALLOW_IDP_UNLINK: defaults to
// false, coerces the exact string 'true' to true, treats any other value as false.

describe('env schema — ALLOW_IDP_LINK_ANY_EMAIL (default false, fail-closed)', () => {
  it("defaults to false, coerces the exact string 'true' to true, and treats any other value as false", () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: { ...BASE } }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_LINK_ANY_EMAIL).to.equal(false);
    });

    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, ALLOW_IDP_LINK_ANY_EMAIL: 'true' },
    }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_LINK_ANY_EMAIL).to.equal(true);
    });

    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, ALLOW_IDP_LINK_ANY_EMAIL: '1' },
    }).then((v) => {
      expect((v.outcome.data as Record<string, unknown>).ALLOW_IDP_LINK_ANY_EMAIL).to.equal(false);
    });
  });
});

// ── VERIFICATION_MAIL_* (Task 5: mTLS verification-mail delivery client) ─────
// All four vars are optional. Delivery is permissive-off (mirrors AUTH_EMAIL_DELIVERY_ENABLED's
// posture, NOT the fail-closed AUTH_EMAIL_VERIFICATION_REQUIRED polarity above): unset means
// sendVerificationMail short-circuits to `false` and signup still succeeds — the user recovers
// via resend, the same posture as resendIfSquatted. See verification-mail.cy.ts for the client's
// own behavioral contracts; this suite only covers the env schema shape.

describe('env schema — VERIFICATION_MAIL_* (mTLS verification-mail delivery client)', () => {
  it('parses successfully with all four vars unset (delivery disabled)', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: { ...BASE } }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      const data = v.outcome.data as Record<string, unknown>;
      expect(data.VERIFICATION_MAIL_URL, 'unset → delivery disabled').to.equal(undefined);
      expect(data.VERIFICATION_MAIL_CLIENT_CERT_FILE).to.equal(undefined);
      expect(data.VERIFICATION_MAIL_CLIENT_KEY_FILE).to.equal(undefined);
      expect(data.VERIFICATION_MAIL_CA_CERT_FILE).to.equal(undefined);
    });
  });

  it('parses successfully with all four vars set and threads every value through unchanged', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...BASE,
        VERIFICATION_MAIL_URL: 'https://zitadel-provider.example/webhooks/verification-mail',
        // File PATHS now, not PEM content — matches the mounted-Secret-volume shape every other
        // cert consumer in infra uses (e.g. /etc/kubernetes/milo/pki/client/tls.crt).
        VERIFICATION_MAIL_CLIENT_CERT_FILE: '/etc/kubernetes/milo/pki/client/tls.crt',
        VERIFICATION_MAIL_CLIENT_KEY_FILE: '/etc/kubernetes/milo/pki/client/tls.key',
        VERIFICATION_MAIL_CA_CERT_FILE: '/etc/ssl/certs/datum-ca.crt',
      },
    }).then((v) => {
      expect(v.outcome.success).to.equal(true);
      const data = v.outcome.data as Record<string, unknown>;
      expect(data.VERIFICATION_MAIL_URL).to.equal(
        'https://zitadel-provider.example/webhooks/verification-mail'
      );
      expect(data.VERIFICATION_MAIL_CLIENT_CERT_FILE).to.equal(
        '/etc/kubernetes/milo/pki/client/tls.crt'
      );
      expect(data.VERIFICATION_MAIL_CLIENT_KEY_FILE).to.equal(
        '/etc/kubernetes/milo/pki/client/tls.key'
      );
      expect(data.VERIFICATION_MAIL_CA_CERT_FILE).to.equal('/etc/ssl/certs/datum-ca.crt');
    });
  });

  it('rejects a non-URL VERIFICATION_MAIL_URL', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, VERIFICATION_MAIL_URL: 'not-a-url' },
    }).then((v) => {
      expect(v.outcome.success).to.equal(false);
      expect(
        (v.outcome.issues as Array<{ path: unknown[] }>).some(
          (i) => i.path[0] === 'VERIFICATION_MAIL_URL'
        )
      ).to.equal(true);
    });
  });

  // MINOR 5 (final-findings.md): half-configured delivery must fail at BOOT, not silently
  // no-op at runtime. Gated on https — the node-spec test harness itself uses plain http://
  // VERIFICATION_MAIL_URL values without certs (verification-mail.cy.ts, signup.service.cy.ts),
  // which is fine: postJson never builds a client-cert Agent for a non-https target.
  it('FAILS when an https VERIFICATION_MAIL_URL is set but any of CLIENT_CERT_FILE/CLIENT_KEY_FILE/CA_CERT_FILE is missing', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: {
        ...BASE,
        VERIFICATION_MAIL_URL: 'https://zitadel-provider.example/webhooks/verification-mail',
        VERIFICATION_MAIL_CLIENT_CERT_FILE: '/etc/kubernetes/milo/pki/client/tls.crt',
        // CLIENT_KEY_FILE and CA_CERT_FILE deliberately omitted.
      },
    }).then((v) => {
      expect(v.outcome.success).to.equal(false);
      expect(
        (v.outcome.issues as Array<{ path: unknown[] }>).some(
          (i) => i.path[0] === 'VERIFICATION_MAIL_URL'
        ),
        'issue must be reported against VERIFICATION_MAIL_URL'
      ).to.equal(true);
    });
  });

  it('does NOT fail for an http:// VERIFICATION_MAIL_URL with no certs set (the node-spec test-harness shape)', () => {
    callService({
      fn: 'envSchemaFull',
      parseEnvRaw: { ...BASE, VERIFICATION_MAIL_URL: 'http://127.0.0.1:58799/webhook' },
    }).then((v) => {
      expect(v.outcome.success, JSON.stringify(v.outcome.issues)).to.equal(true);
    });
  });

  it('does NOT fail (CRITICAL 1 fallback) when VERIFICATION_MAIL_URL is unset, regardless of certs', () => {
    callService({ fn: 'envSchemaFull', parseEnvRaw: { ...BASE } }).then((v) => {
      expect(v.outcome.success, JSON.stringify(v.outcome.issues)).to.equal(true);
    });
  });
});
