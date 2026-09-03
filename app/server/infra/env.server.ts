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
    // Comma-separated list of trusted values for x-zitadel-forward-host.
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
    // Optional ops pin for the org-first / default-org fallback (resolveOrg). When set, a login
    // without an explicit `?organization=` (or OIDC org-id scope) uses THIS org id instead of
    // calling the provider's getDefaultOrg. Unset (default) ⇒ resolveOrg falls back to the
    // provider's instance Default Organization. No default value.
    ZITADEL_DEFAULT_ORG_ID: z.string().optional(),
    // Fallback destination after a standalone login (e.g. when no ?redirect param
    // is present). Optional — unset in dev/test; the route supplies its own default.
    DEFAULT_APP_URL: z.url().optional(),
    // Comma-separated list of allowed absolute origins for the OIDC RP-initiated logout
    // post_logout_redirect parameter (e.g. http://localhost:3001,https://portal.example.com).
    // Optional — unset means only same-origin relative paths are permitted (fail-closed).
    POST_LOGOUT_ALLOWLIST: z.string().optional(),
    // Observability: Sentry error monitoring + tracing.
    // Both vars are OPTIONAL — unset means Sentry is disabled at boot (true no-op).
    // SENTRY_DSN must be a valid https DSN when set; an invalid value fails fast at startup.
    SENTRY_DSN: z
      .string()
      .url()
      .refine((u) => u.startsWith('https://'), {
        message: 'SENTRY_DSN must be an https:// URL',
      })
      .optional(),
    // Fraction of requests to sample for performance tracing (0.0–1.0 string).
    // Defaults to '0.1' (10%) when Sentry is enabled but this var is not set.
    SENTRY_TRACES_SAMPLE_RATE: z
      .string()
      .optional()
      .transform((v) => (v !== undefined ? parseFloat(v) : 0.1))
      .pipe(z.number().min(0).max(1)),
    // Rybbit analytics site id. OPTIONAL — unset means analytics is a true no-op
    // everywhere. Active in EVERY environment (dev, staging, preview, production) once set —
    // no environment gating in the root loader (see resolveRybbitSiteId in
    // app/modules/analytics/rybbit.tsx).
    RYBBIT_SITE_ID: z.string().optional(),
    // Rybbit `data-tag` cohort-segmentation attribute (e.g. "production"/"staging"/"preview").
    // Optional — unset means the script tag omits data-tag.
    RYBBIT_TAG: z.string().optional(),
    // Rybbit server-side tracking API key (POST /api/track), used ONLY for signup moments
    // that never render an auth-ui page (e.g. an IdP signup completing mid-OIDC-ceremony,
    // which redirects the browser straight to the relying party — see
    // app/modules/analytics/rybbit.server.ts). Optional: unauthenticated track calls still
    // work, just without bot/domain-spoofing protection.
    RYBBIT_API_KEY: z.string().optional(),
    // MaxMind minFraud device-fingerprinting account id. Optional in EVERY environment
    // (staging may want fraud detection too). Unset ⇒ the signup MaxMind tracker is a
    // true no-op (no device.js loaded, no token captured). Exposed to the client only
    // via the signup loaders (no window.ENV machinery in this app).
    MAXMIND_ACCOUNT_ID: z.string().optional(),
    // Whether email delivery is wired in THIS environment. Email is sent via our BE/infra
    // (not Zitadel SMTP), so this is an explicit switch, not auto-detected. Unset => OFF
    // (fail-safe): magic-link + password-reset stay hidden so we never offer a dead-end flow.
    AUTH_EMAIL_DELIVERY_ENABLED: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
    // Whether email VERIFICATION is required before a signup can complete. Distinct from
    // AUTH_EMAIL_DELIVERY_ENABLED (which says whether mail can be sent at all): an environment
    // can have delivery wired and still skip verification.
    //
    // FAIL-CLOSED: unset => ON. Requiring proof of address ownership is the SAFE state, and the
    // unsafe direction is not a mere nuisance — with verification off, registerWithPassword
    // passes emailVerified:true, so a missing env var silently mints accounts on addresses
    // nobody proved they own. Only an explicit 'false'/'0' skips verification (resolved below,
    // together with the deprecated alias — same transform on both: `v !== 'false' && v !== '0'`).
    // Deployments that genuinely skip it (no-delivery staging) must opt out in writing — see
    // AUTH_EMAIL_VERIFICATION_REQUIRED in .env.example.
    //
    // NOTE: this REVERSES the legacy default (a raw process.env read in app/server/env.ts that
    // treated unset as off). Any environment relying on unset must now set
    // AUTH_EMAIL_VERIFICATION_REQUIRED=false explicitly.
    // Phase B: deleted entirely after the B4 production flip, along with every
    // `requireVerification: false` branch it keeps alive — the deprecated EMAIL_VERIFICATION
    // alias immediately below is removed at the same time.
    AUTH_EMAIL_VERIFICATION_REQUIRED: z.string().optional(),
    // Deprecated name for AUTH_EMAIL_VERIFICATION_REQUIRED above — same values, same meaning.
    // Deployments still set this name; silently dropping it would flip them to verification-ON
    // and dead-end every signup, so it stays honoured (new name wins when both are set — see the
    // resolution in the final .transform() below) until removed at the B4 flip.
    EMAIL_VERIFICATION: z.string().optional(),
    // Base URL of the zitadel-provider authn-webhook that creates verification Email
    // resources. Unset disables delivery: signup still succeeds and the user recovers
    // via resend, which is the same posture as resendIfSquatted.
    VERIFICATION_MAIL_URL: z.url().optional(),
    // Paths to the client cert + key + CA files for mTLS to that endpoint — a mounted Secret
    // volume, matching every other cert consumer in infra (cloud-portal, fraud, compute-system),
    // not PEM content in the env value itself. Read fresh per-request from these paths in
    // verification-mail.server.ts (never cached at boot) so a rotated Secret takes effect without
    // a pod restart — env sourced via secretKeyRef is set once at pod creation and would otherwise
    // let the short-lived cert expire in place.
    VERIFICATION_MAIL_CLIENT_CERT_FILE: z.string().optional(),
    VERIFICATION_MAIL_CLIENT_KEY_FILE: z.string().optional(),
    VERIFICATION_MAIL_CA_CERT_FILE: z.string().optional(),
    // Operational kill switch for the usernameless discovery entry points (the /login
    // loader's identity-challenge arm and the /login/passkey-discover action). Default ON
    // — unset keeps the feature live; ONLY the explicit strings 'false'/'0' disable it.
    // Inverse polarity from the fail-safe-off flags above on purpose: this exists so an
    // incident can be mitigated by config instead of a revert deploy, not to gate rollout.
    AUTH_PASSKEY_DISCOVERY_ENABLED: z
      .string()
      .optional()
      .transform((v) => v !== 'false' && v !== '0'),
    // Whether identity-provider UNLINK is permitted in this environment. Defaults to false
    // (fail-closed): only the exact string 'true' enables it. Was an unvalidated raw
    // process.env read in sso.service.ts.
    ALLOW_IDP_UNLINK: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // Whether to AUTO-LINK an external IdP identity into an existing same-email account on the
    // LOGIN/REGISTER flow (no explicit link ceremony). Defaults to false (fail-closed): a
    // same-email collision becomes a hard `account-exists` error and the owner must link the IdP
    // from the signed-in /sso screen instead. Only the exact string 'true' re-enables the legacy
    // path (auto-link when the IdP email is verified + the account is passwordless; otherwise
    // link-needs-auth). Mirrors the ALLOW_IDP_UNLINK coercion.
    ALLOW_IDP_AUTO_LINK: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // Whether the EXPLICIT SSO link ceremony may attach a FRESH external identity regardless of
    // its email address. Defaults to FALSE (fail-closed — mirrors ALLOW_IDP_UNLINK): only the exact
    // string 'true' enables it. When on, a signed-in user can link any Google/GitHub identity to
    // their own account (email-ownership is enforced later at email-update time on the backend);
    // when unset/off the strict POSTURE B2 gate applies (the IdP-verified email must already be
    // owned by the session user). Enable per-environment via infra env.
    ALLOW_IDP_LINK_ANY_EMAIL: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // CSP `frame-ancestors` override. Unset ⇒ 'none' (secure default — the auth UI is
    // not embeddable; X-Frame-Options: DENY is kept in lock-step). Set to a space/comma-
    // separated allowlist of full origins (e.g. "https://staging.portal.example.com") in
    // environments that MUST embed the auth UI. Parsed/validated by resolveFrameAncestors
    // (a bare `*` is rejected). NEXT_PUBLIC_FRAME_ANCESTORS is the legacy alias from the
    // old Next.js app — FRAME_ANCESTORS is canonical and wins when both are set.
    FRAME_ANCESTORS: z.string().optional(),
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
    // Half-configured mail delivery: VERIFICATION_MAIL_URL set but the mTLS material isn't —
    // sendVerificationMail's https.Agent gets undefined cert/key/ca, the zitadel-provider
    // webhook rejects the handshake, and every attempt fails SILENTLY (sendVerificationMail
    // never throws — see verification-mail.server.ts). Only checked for https targets: a plain
    // http:// target (the node-spec test harness only, never a real deployment) never builds an
    // Agent at all, so missing certs there are inert, not a bug. An UNSET URL is fine on its own
    // — that's the CRITICAL-1 fallback (signup.service.ts), not this check's concern.
    if (
      v.VERIFICATION_MAIL_URL?.startsWith('https://') &&
      (!v.VERIFICATION_MAIL_CLIENT_CERT_FILE ||
        !v.VERIFICATION_MAIL_CLIENT_KEY_FILE ||
        !v.VERIFICATION_MAIL_CA_CERT_FILE)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['VERIFICATION_MAIL_URL'],
        message:
          'VERIFICATION_MAIL_URL is set to an https URL but VERIFICATION_MAIL_CLIENT_CERT_FILE / ' +
          '_CLIENT_KEY_FILE / _CA_CERT_FILE are not all set — mTLS to the webhook would fail on ' +
          'every call, and that failure is silent at runtime. Set all three, or unset ' +
          'VERIFICATION_MAIL_URL to disable delivery in this environment.',
      });
    }
  })
  .transform((v) => {
    // AUTH_EMAIL_VERIFICATION_REQUIRED wins when both names are set — a deployment mid-migration
    // that sets both should land on the new name, not the old one. The deprecation warning below
    // fires only on the old-name-only path; it runs once per parse, which at real startup
    // (schema.parse(process.env) below) means once per process.
    const parseRequireVerification = (raw: string) => raw !== 'false' && raw !== '0';
    let requireEmailVerification: boolean;
    if (v.AUTH_EMAIL_VERIFICATION_REQUIRED !== undefined) {
      requireEmailVerification = parseRequireVerification(v.AUTH_EMAIL_VERIFICATION_REQUIRED);
    } else if (v.EMAIL_VERIFICATION !== undefined) {
      requireEmailVerification = parseRequireVerification(v.EMAIL_VERIFICATION);
      // Keep this text greppable — ops greps for it when chasing down stale deployment config.
      console.warn(
        '[env] EMAIL_VERIFICATION is deprecated; rename it to AUTH_EMAIL_VERIFICATION_REQUIRED (same values, same meaning)'
      );
    } else {
      requireEmailVerification = true;
    }
    return {
      ...v,
      ZITADEL_API_URL: v.ZITADEL_API_URL ?? 'http://localhost:8080',
      // Canonical FRAME_ANCESTORS, falling back to the legacy NEXT_PUBLIC_ alias. Still a
      // raw string here (or undefined) — resolveFrameAncestors validates/parses it at the
      // header layer (app/server/middleware/secure-headers.ts).
      FRAME_ANCESTORS: v.FRAME_ANCESTORS,
      // Parse comma-separated trusted hosts into an array (undefined when unset → empty = reject all).
      ZITADEL_TRUSTED_FORWARD_HOSTS: v.ZITADEL_TRUSTED_FORWARD_HOSTS
        ? v.ZITADEL_TRUSTED_FORWARD_HOSTS.split(',')
            .map((h) => h.trim())
            .filter(Boolean)
        : [],
      AUTH_EMAIL_VERIFICATION_REQUIRED: requireEmailVerification,
      // SENTRY_TRACES_SAMPLE_RATE was already transformed to a number by the .pipe() above;
      // preserve the already-parsed value (spread covers it from `v`).
      // PUBLIC_ORIGIN: no default — carried through by `...v`. It is `undefined` only in
      // dev/test/fake (where trustedAppOrigin falls back to the request origin); in
      // production+zitadel it is guaranteed present (the superRefine guard fails boot otherwise).
    };
  });

/** Exported for unit testing only — do not use in application code; use `env` instead. */
export const _envSchema = schema;

export const env = schema.parse(process.env);
