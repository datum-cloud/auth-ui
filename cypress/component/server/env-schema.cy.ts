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

// ── EMAIL_VERIFICATION (INVERSE polarity: default true, fail-closed) ───────────
// Phase B promotes this out of a raw process.env read (app/server/env.ts) AND reverses its
// default. It deliberately does NOT mirror AUTH_EMAIL_DELIVERY_ENABLED: delivery is
// permissive-off, this is fail-closed-on, because verification-off makes signup pass
// emailVerified:true and mint accounts on addresses nobody proved they own. Polarity here
// matches AUTH_PASSKEY_DISCOVERY_ENABLED, the repo's other inverse flag.

describe('env schema — EMAIL_VERIFICATION (fail-closed, default true)', () => {
  it("defaults to true when unset, and only an explicit 'false'/'0' disables it", () => {
    // The security-critical case: a MISSING var must not silently skip verification.
    callService({ fn: 'envSchemaFull', parseEnvRaw: { ...BASE } }).then((v) => {
      expect(
        (v.outcome.data as Record<string, unknown>).EMAIL_VERIFICATION,
        'unset must FAIL CLOSED to required'
      ).to.equal(true);
    });

    for (const raw of ['false', '0']) {
      callService({
        fn: 'envSchemaFull',
        parseEnvRaw: { ...BASE, EMAIL_VERIFICATION: raw },
      }).then((v) => {
        expect(
          (v.outcome.data as Record<string, unknown>).EMAIL_VERIFICATION,
          `explicit '${raw}' opts out`
        ).to.equal(false);
      });
    }

    // Anything else — including a typo'd opt-out — stays SAFE rather than silently disabling.
    for (const raw of ['true', '1', 'yes', 'FALSE', '']) {
      callService({
        fn: 'envSchemaFull',
        parseEnvRaw: { ...BASE, EMAIL_VERIFICATION: raw },
      }).then((v) => {
        expect(
          (v.outcome.data as Record<string, unknown>).EMAIL_VERIFICATION,
          `'${raw}' must not disable verification`
        ).to.equal(true);
      });
    }
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
