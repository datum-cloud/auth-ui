import { z } from 'zod';

const schema = z
  .object({
    SESSION_SECRET: z
      .string()
      .min(32, 'SESSION_SECRET must be at least 32 characters (HMAC-SHA256 key)'),
    ZITADEL_SERVICE_USER_TOKEN: z.string().optional(),
    ZITADEL_API_URL: z.url().optional(),
    // Trusted origin (scheme + host, e.g. https://auth.datum.net or http://localhost:3000)
    // for verification-email links. MUST be sourced from config, NOT the request Host
    // header — the Host header is client-controllable and was used to build the
    // verification link, letting an attacker phish a victim's real verification code to
    // an attacker-controlled host. Required in production (AUTH_PROVIDER=zitadel) below.
    PUBLIC_ORIGIN: z.url().optional(),
    // Provider selector. Anything other than 'fake' resolves to the Zitadel adapter
    // (matches select.server / providerForRequest), so the Zitadel env requirements
    // below apply whenever this is unset or 'zitadel' — never for 'fake'.
    AUTH_PROVIDER: z.string().optional(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    // EL-TRANSPORT-1: comma-separated list of trusted values for x-zitadel-forward-host.
    // Unset (default) = reject ALL forward-host overrides (fail-closed).
    ZITADEL_TRUSTED_FORWARD_HOSTS: z.string().optional(),
    // Extra headers injected on EVERY outbound Zitadel API request (applied as a Connect
    // interceptor in providers/zitadel/transport.ts). Format: comma-separated `Key:Value`
    // pairs, e.g. `x-zitadel-public-host:auth.datum.net,x-zitadel-public-proto:https`.
    // Use when auth-ui reaches Zitadel via an internal address but Zitadel must mint
    // public-facing URLs (OIDC issuer, SAML metadata/ACS, redirect-URI checks). Unset =
    // no extra headers. (Renamed from the fork's `CUSTOM_REQUEST_HEADERS` — Zitadel-only,
    // so it now carries the ZITADEL_ prefix like the other transport vars.)
    ZITADEL_CUSTOM_REQUEST_HEADERS: z.string().optional(),
    // Fallback destination after a standalone login (e.g. when no ?redirect param
    // is present). Optional — unset in dev/test; the route supplies its own default.
    DEFAULT_APP_URL: z.url().optional(),
    // Comma-separated list of allowed absolute origins for the OIDC RP-initiated logout
    // post_logout_redirect parameter (e.g. http://localhost:3001,https://portal.example.com).
    // Optional — unset means only same-origin relative paths are permitted (fail-closed).
    POST_LOGOUT_ALLOWLIST: z.string().optional(),
    // P7 observability: Sentry error monitoring + tracing.
    // Both vars are OPTIONAL — unset means Sentry is disabled at boot (true no-op).
    // SENTRY_DSN must be a valid https DSN when set; an invalid value fails fast at startup.
    SENTRY_DSN: z.url().optional(),
    // Fraction of requests to sample for performance tracing (0.0–1.0 string).
    // Defaults to '0.1' (10%) when Sentry is enabled but this var is not set.
    SENTRY_TRACES_SAMPLE_RATE: z
      .string()
      .optional()
      .transform((v) => (v !== undefined ? parseFloat(v) : 0.1))
      .pipe(z.number().min(0).max(1)),
    // Fathom analytics site id. OPTIONAL — unset means analytics is a true no-op
    // everywhere. Exposure to the client is additionally prod-gated in the root
    // loader (see resolveFathomSiteId in app/modules/analytics/fathom.tsx): dev and
    // preview never contact Fathom even when this is set.
    FATHOM_ID: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    // Zitadel creds are only required when the Zitadel adapter is actually selected.
    // AUTH_PROVIDER=fake (prod-mode fake runs: a11y audit, perf, load) needs neither.
    const usesZitadel = v.NODE_ENV === 'production' && v.AUTH_PROVIDER !== 'fake';
    if (usesZitadel && !v.ZITADEL_API_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['ZITADEL_API_URL'],
        message: 'ZITADEL_API_URL must be set in production (AUTH_PROVIDER=zitadel)',
      });
    }
    if (usesZitadel && !v.ZITADEL_SERVICE_USER_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['ZITADEL_SERVICE_USER_TOKEN'],
        message: 'ZITADEL_SERVICE_USER_TOKEN must be set in production (AUTH_PROVIDER=zitadel)',
      });
    }
    if (usesZitadel && !v.PUBLIC_ORIGIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_ORIGIN'],
        message:
          'PUBLIC_ORIGIN must be set in production (AUTH_PROVIDER=zitadel) — verification-email links must not trust the request Host header',
      });
    }
    // The k8s manifest ships `PUBLIC_ORIGIN=https://REPLACE_ME.example` as a placeholder
    // (it passes z.url()). Fail closed if ops forgot to set the real origin at cutover —
    // otherwise verification/reset email links would point at REPLACE_ME.example. Match
    // ONLY the literal placeholder marker so real origins (incl. http://localhost:3000
    // used by acceptance specs) still pass.
    if (usesZitadel && v.PUBLIC_ORIGIN && v.PUBLIC_ORIGIN.includes('REPLACE_ME')) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_ORIGIN'],
        message: 'PUBLIC_ORIGIN is still the deployment placeholder — set the real public origin',
      });
    }
  })
  .transform((v) => ({
    ...v,
    ZITADEL_API_URL: v.ZITADEL_API_URL ?? 'http://localhost:8080',
    // Parse comma-separated trusted hosts into an array (undefined when unset → empty = reject all).
    ZITADEL_TRUSTED_FORWARD_HOSTS: v.ZITADEL_TRUSTED_FORWARD_HOSTS
      ? v.ZITADEL_TRUSTED_FORWARD_HOSTS.split(',')
          .map((h) => h.trim())
          .filter(Boolean)
      : [],
    // SENTRY_TRACES_SAMPLE_RATE was already transformed to a number by the .pipe() above;
    // preserve the already-parsed value (spread covers it from `v`).
    // PUBLIC_ORIGIN: no default — carried through by `...v`. It is `undefined` only in
    // dev/test/fake (where trustedAppOrigin falls back to the request origin); in
    // production+zitadel it is guaranteed present (the superRefine guard fails boot otherwise).
  }));

/** Exported for unit testing only — do not use in application code; use `env` instead. */
export const _envSchema = schema;

export const env = schema.parse(process.env);
