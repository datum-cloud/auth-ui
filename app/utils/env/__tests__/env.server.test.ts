/**
 * Unit tests for the env.server.ts Zod schema — specifically the P7 Sentry vars.
 *
 * We import `_envSchema` directly so we can call `.safeParse` with arbitrary
 * inputs without touching `process.env` or triggering module-load side-effects.
 */
import { _envSchema } from '@/utils/env/env.server';
import { describe, it, expect } from 'vitest';

const BASE = {
  SESSION_SECRET: 'test-secret-test-secret-32-chars!!',
  NODE_ENV: 'test' as const,
};

describe('env schema — production Zitadel requirements (provider-gated)', () => {
  const PROD = {
    SESSION_SECRET: 'test-secret-test-secret-32-chars!!',
    NODE_ENV: 'production' as const,
  };

  it('requires the service token + API URL in production when the provider is zitadel (default)', () => {
    const result = _envSchema.safeParse(PROD); // AUTH_PROVIDER unset → defaults to zitadel
    expect(result.success).toBe(false);
  });

  it('requires the service token in production when AUTH_PROVIDER=zitadel explicitly', () => {
    const result = _envSchema.safeParse({
      ...PROD,
      AUTH_PROVIDER: 'zitadel',
      ZITADEL_API_URL: 'https://zitadel.example',
    });
    expect(result.success).toBe(false); // URL present, token missing → still fails
  });

  it('passes in production with AUTH_PROVIDER=zitadel + token + URL + PUBLIC_ORIGIN', () => {
    const result = _envSchema.safeParse({
      ...PROD,
      AUTH_PROVIDER: 'zitadel',
      ZITADEL_API_URL: 'https://zitadel.example',
      ZITADEL_SERVICE_USER_TOKEN: 'a-token',
      PUBLIC_ORIGIN: 'https://auth.datum.net',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PUBLIC_ORIGIN).toBe('https://auth.datum.net');
    }
  });

  it('accepts and passes through ZITADEL_CUSTOM_REQUEST_HEADERS (optional, not required)', () => {
    const headers = 'x-zitadel-public-host:auth.datum.net,x-zitadel-public-proto:https';
    const withHeaders = _envSchema.safeParse({
      ...PROD,
      AUTH_PROVIDER: 'zitadel',
      ZITADEL_API_URL: 'https://zitadel.example',
      ZITADEL_SERVICE_USER_TOKEN: 'a-token',
      PUBLIC_ORIGIN: 'https://auth.datum.net',
      ZITADEL_CUSTOM_REQUEST_HEADERS: headers,
    });
    expect(withHeaders.success).toBe(true);
    if (withHeaders.success) {
      expect(withHeaders.data.ZITADEL_CUSTOM_REQUEST_HEADERS).toBe(headers);
    }
    // Optional: unset is fine even in production+zitadel (it has no superRefine guard).
    const withoutHeaders = _envSchema.safeParse({
      ...PROD,
      AUTH_PROVIDER: 'zitadel',
      ZITADEL_API_URL: 'https://zitadel.example',
      ZITADEL_SERVICE_USER_TOKEN: 'a-token',
      PUBLIC_ORIGIN: 'https://auth.datum.net',
    });
    expect(withoutHeaders.success).toBe(true);
  });

  it('does NOT require Zitadel vars in production when AUTH_PROVIDER=fake', () => {
    const result = _envSchema.safeParse({ ...PROD, AUTH_PROVIDER: 'fake' });
    expect(result.success).toBe(true);
  });
});

describe('env schema — PUBLIC_ORIGIN (verification-link origin; anti Host-header injection)', () => {
  const PROD = {
    SESSION_SECRET: 'test-secret-test-secret-32-chars!!',
    NODE_ENV: 'production' as const,
  };

  it('FAILS in production (AUTH_PROVIDER=zitadel) when PUBLIC_ORIGIN is missing — fail-closed', () => {
    // Even with both Zitadel creds present, a missing PUBLIC_ORIGIN must fail boot:
    // without it the verification link would fall back to the request Host header.
    const result = _envSchema.safeParse({
      ...PROD,
      AUTH_PROVIDER: 'zitadel',
      ZITADEL_API_URL: 'https://zitadel.example',
      ZITADEL_SERVICE_USER_TOKEN: 'a-token',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'PUBLIC_ORIGIN')).toBe(true);
    }
  });

  it('does NOT require PUBLIC_ORIGIN in production when AUTH_PROVIDER=fake', () => {
    const result = _envSchema.safeParse({ ...PROD, AUTH_PROVIDER: 'fake' });
    expect(result.success).toBe(true);
  });

  it('accepts absent PUBLIC_ORIGIN outside production (dev/test fall back to request origin)', () => {
    const result = _envSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PUBLIC_ORIGIN).toBeUndefined();
    }
  });

  it('rejects a non-URL PUBLIC_ORIGIN', () => {
    const result = _envSchema.safeParse({ ...BASE, PUBLIC_ORIGIN: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('FAILS in production (zitadel) when PUBLIC_ORIGIN is still the deployment placeholder', () => {
    // The k8s manifest ships PUBLIC_ORIGIN=https://REPLACE_ME.example as a placeholder.
    // It passes z.url(), so without this guard prod could boot with the placeholder and
    // mail verification/reset links pointing at REPLACE_ME.example. Fail closed.
    const result = _envSchema.safeParse({
      ...PROD,
      AUTH_PROVIDER: 'zitadel',
      ZITADEL_API_URL: 'https://zitadel.example',
      ZITADEL_SERVICE_USER_TOKEN: 'a-token',
      PUBLIC_ORIGIN: 'https://REPLACE_ME.example',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'PUBLIC_ORIGIN')).toBe(true);
    }
  });

  it('accepts a real http://localhost origin (placeholder guard rejects only REPLACE_ME)', () => {
    // Acceptance specs boot prod-mode with PUBLIC_ORIGIN=http://localhost:3000 — the
    // placeholder guard must reject ONLY the literal REPLACE_ME marker, never a real origin.
    const result = _envSchema.safeParse({
      ...PROD,
      AUTH_PROVIDER: 'zitadel',
      ZITADEL_API_URL: 'https://zitadel.example',
      ZITADEL_SERVICE_USER_TOKEN: 'a-token',
      PUBLIC_ORIGIN: 'http://localhost:3000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PUBLIC_ORIGIN).toBe('http://localhost:3000');
    }
  });
});

describe('env schema — SENTRY_DSN', () => {
  it('accepts absent SENTRY_DSN (Sentry disabled)', () => {
    const result = _envSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SENTRY_DSN).toBeUndefined();
    }
  });

  it('accepts a valid https DSN', () => {
    const result = _envSchema.safeParse({
      ...BASE,
      SENTRY_DSN: 'https://examplePublicKey@o0.ingest.sentry.io/0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SENTRY_DSN).toBe('https://examplePublicKey@o0.ingest.sentry.io/0');
    }
  });

  it('rejects a non-URL SENTRY_DSN', () => {
    const result = _envSchema.safeParse({ ...BASE, SENTRY_DSN: 'not-a-url' });
    expect(result.success).toBe(false);
  });
});

describe('env schema — SENTRY_TRACES_SAMPLE_RATE', () => {
  it('defaults to 0.1 when SENTRY_TRACES_SAMPLE_RATE is absent', () => {
    const result = _envSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SENTRY_TRACES_SAMPLE_RATE).toBe(0.1);
    }
  });

  it('parses a string "0.5" to the number 0.5', () => {
    const result = _envSchema.safeParse({
      ...BASE,
      SENTRY_TRACES_SAMPLE_RATE: '0.5',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SENTRY_TRACES_SAMPLE_RATE).toBe(0.5);
    }
  });

  it('accepts "0" (disable sampling)', () => {
    const result = _envSchema.safeParse({
      ...BASE,
      SENTRY_TRACES_SAMPLE_RATE: '0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SENTRY_TRACES_SAMPLE_RATE).toBe(0);
    }
  });

  it('accepts "1" (sample everything)', () => {
    const result = _envSchema.safeParse({
      ...BASE,
      SENTRY_TRACES_SAMPLE_RATE: '1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SENTRY_TRACES_SAMPLE_RATE).toBe(1);
    }
  });

  it('rejects a value above 1', () => {
    const result = _envSchema.safeParse({
      ...BASE,
      SENTRY_TRACES_SAMPLE_RATE: '1.5',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative value', () => {
    const result = _envSchema.safeParse({
      ...BASE,
      SENTRY_TRACES_SAMPLE_RATE: '-0.1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric string', () => {
    const result = _envSchema.safeParse({
      ...BASE,
      SENTRY_TRACES_SAMPLE_RATE: 'high',
    });
    expect(result.success).toBe(false);
  });
});

describe('env schema — DEFAULT_APP_URL (optional post-login fallback destination)', () => {
  it('passes through DEFAULT_APP_URL when set to a valid URL', () => {
    const result = _envSchema.safeParse({
      ...BASE,
      DEFAULT_APP_URL: 'http://localhost:3001',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DEFAULT_APP_URL).toBe('http://localhost:3001');
    }
  });

  it('leaves DEFAULT_APP_URL undefined when not set', () => {
    const result = _envSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DEFAULT_APP_URL).toBeUndefined();
    }
  });
});

describe('env schema — FATHOM_ID (optional analytics site id)', () => {
  it('passes through FATHOM_ID when set', () => {
    const result = _envSchema.safeParse({ ...BASE, FATHOM_ID: 'ABCDEFGH' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.FATHOM_ID).toBe('ABCDEFGH');
    }
  });

  it('leaves FATHOM_ID undefined when not set', () => {
    const result = _envSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.FATHOM_ID).toBeUndefined();
    }
  });
});
