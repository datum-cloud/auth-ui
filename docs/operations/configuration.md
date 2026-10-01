# Configuration

Every environment variable the app reads. The schema in `app/server/infra/env.server.ts` is the
single source of truth. It is parsed **once at boot**, so a missing or invalid required variable
**fails the process at startup**, not at first request.

`.env.example` carries most of the same list inline, with comments. Where the two differ, the
schema wins.

## Required in production

"Production" here means precisely `NODE_ENV=production` **and** `AUTH_PROVIDER` set to anything
other than `fake`. The `superRefine` guard in the schema enforces these three only under that
condition; `SESSION_SECRET` is required in every environment.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SESSION_SECRET` | Always | none | HMAC-SHA256 key for signing session cookies, and the root the recovery-ticket key is derived from. **Minimum 32 characters**: shorter values fail validation at boot. Generate with `openssl rand -base64 32`. |
| `ZITADEL_API_URL` | Production (Zitadel) | `http://localhost:8080` | Base URL of the Zitadel API. The default only applies outside production. |
| `ZITADEL_SERVICE_USER_TOKEN` | Production (Zitadel) | none | Service-user PAT used for every server-to-server Zitadel call. Secret. |
| `PUBLIC_ORIGIN` | Production (Zitadel) | none | Trusted origin (scheme + host) used to build verification, recovery and password-reset email links, and the hostname reCAPTCHA tokens must match. Sourced from config, **never** the request `Host` header, which is client-controllable. |

## Zitadel transport

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ZITADEL_TRUSTED_FORWARD_HOSTS` | No | unset → reject all | Comma-separated allowlist of trusted values for the `x-zitadel-forward-host` header. Unset means **every** forward-host override is rejected (fail-closed). |
| `ZITADEL_CUSTOM_REQUEST_HEADERS` | No | unset → no extra headers | Comma-separated `Key:Value` pairs injected on every outbound Zitadel API request (a Connect interceptor). Use when auth-ui reaches Zitadel over an internal address but Zitadel must mint public-facing URLs (OIDC issuer, SAML metadata/ACS, redirect-URI checks). Example: `x-zitadel-public-host:auth.datum.net,x-zitadel-public-proto:https`. |
| `ZITADEL_DEFAULT_ORG_ID` | No | unset → provider default org | Ops pin for the org-first fallback (`resolveOrg`). When set, a login without an explicit `?organization=` (or OIDC org-id scope) uses this org id instead of calling the provider's default-org lookup. See [ADR 005](../architecture/adrs/005-login-org-scoping.md). |

## Feature flags

Polarity differs per flag, so read each row. Most default to **off** and only the exact string
`true` enables them (`AUTH_EMAIL_DELIVERY_ENABLED` and `AUTH_ACCOUNT_RECOVERY_ENABLED` also accept
`1`). Two default to **on**, because for them the safe state is "on":
`AUTH_EMAIL_VERIFICATION_REQUIRED` and `AUTH_PASSKEY_DISCOVERY_ENABLED`. Only `false` or `0`
turns those off. See [ADR 004](../architecture/adrs/004-idp-linking-flags.md) for the three IdP
linking flags.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AUTH_EMAIL_DELIVERY_ENABLED` | No | `false` | Whether email delivery is wired in this environment (email is sent via Datum infra, not Zitadel SMTP, so this is an explicit switch, not auto-detected). Off keeps magic-link sign-in and password reset hidden and refuses passkey signup, so the UI never offers a dead-end flow. |
| `AUTH_EMAIL_VERIFICATION_REQUIRED` | No | `true` | Whether signup must verify the address. **Default on**: only `false` or `0` skips it, and skipping makes password registration pass `emailVerified: true`. Read through `requireEmailVerification()` in `app/server/env.ts`. Temporary; the source marks it for removal once production runs with verification on. |
| `EMAIL_VERIFICATION` | No | unset | **Deprecated** name for `AUTH_EMAIL_VERIFICATION_REQUIRED`, same values and meaning. Honoured only when the new name is unset, and then logs `[env] EMAIL_VERIFICATION is deprecated; rename it to AUTH_EMAIL_VERIFICATION_REQUIRED` once at boot. |
| `AUTH_ACCOUNT_RECOVERY_ENABLED` | No | `false` | Self-serve passkey recovery. Off makes `/recover` and `/recover/complete` return 404 from loader and action and hides every entry-point link. See [Account Recovery](../architecture/account-recovery.md). |
| `AUTH_PASSKEY_DISCOVERY_ENABLED` | No | `true` | Kill switch for usernameless passkey discovery: the `/login` loader's discovery arm and the `/login/passkey-discover` action. **Default on**; only `false` or `0` disables it. It exists so an incident can be mitigated by config instead of a revert deploy. |
| `ALLOW_IDP_AUTO_LINK` | No | `false` | Auto-links an external IdP identity into an existing same-email account during login/register. Off means a same-email collision is a hard `account-exists` error and the owner must link the IdP from the signed-in `/sso` screen. |
| `ALLOW_IDP_LINK_ANY_EMAIL` | No | `false` | Lets the explicit SSO link ceremony attach a fresh external identity regardless of its email address. Off applies the strict gate: the IdP-verified email must already be owned by the session user. |
| `ALLOW_IDP_UNLINK` | No | `false` | Permits unlinking an identity provider from an account. |
| `IDP_AUTO_CREATE_EMAIL_DOMAINS` | No | unset | **Temporary, [ADR 007](../architecture/adrs/007-staging-idp-auto-create-allowlist.md).** Comma-separated email domains whose IdP-verified identities may auto-create a user in an org whose login policy disallows registration. Unset means the feature is off. |
| `IDP_AUTO_CREATE_ORGS` | No | unset | **Temporary, ADR 007.** Comma-separated Zitadel org ids the door applies to. Required together with the domain list; unset means the feature is off. |
| `IDP_AUTO_CREATE_ALIAS_TAG` | No | `staff` | **Temporary, ADR 007.** The `+<tag>` inserted into the email's local part when that email already owns a user in another org. Only read when the domain list is set. |

## Email delivery

Verification and recovery mail go out through the zitadel-provider authn webhook over mTLS. Both
endpoints live on the same host and use one set of client material. The certificate files are
read on every request, never cached at boot, so a rotated Secret takes effect without a restart
(`app/server/infra/mail-webhook.server.ts`).

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `VERIFICATION_MAIL_URL` | No | unset → Zitadel sends | Webhook endpoint that creates signup verification mail. Unset falls back to Zitadel's own mail (a URL template landing on `/signup/complete`), so signup still works. |
| `VERIFICATION_MAIL_CLIENT_CERT_FILE` | With an `https` mail URL | unset | Path to the mTLS client certificate (a mounted Secret volume, not PEM in the env value). |
| `VERIFICATION_MAIL_CLIENT_KEY_FILE` | With an `https` mail URL | unset | Path to the client private key. |
| `VERIFICATION_MAIL_CA_CERT_FILE` | With an `https` mail URL | unset | Path to the CA bundle used to verify the webhook's certificate. |
| `RECOVERY_MAIL_URL` | No | unset → no recovery mail | Webhook endpoint that mints and mails a passkey registration code: the same host as `VERIFICATION_MAIL_URL`, path `/v1/email/recovery`. Shares the three `VERIFICATION_MAIL_*` files. Unset means recovery requests are silently suppressed (logged as `delivery_disabled`). |

The schema refuses to boot when either `VERIFICATION_MAIL_URL` or `RECOVERY_MAIL_URL` is an
`https://` URL and the three certificate files are not all set. Without the check, every send
would fail the mTLS handshake silently, because neither mail client throws. A plain `http://`
target skips mTLS entirely; it exists for the test harness, not for deployments.

## Routing

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DEFAULT_APP_URL` | No | unset → route default | Fallback post-login destination when the request carries no `?redirect` param. |
| `POST_LOGOUT_ALLOWLIST` | No | unset → same-origin only | Comma-separated allowlist of absolute origins accepted for the OIDC RP-initiated logout `post_logout_redirect` target. Unset means only same-origin relative paths are permitted (fail-closed open-redirect guard). |

## Security

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `FRAME_ANCESTORS` | No | `'none'` | CSP `frame-ancestors` allowlist (space- or comma-separated full origins). Unset, empty, wildcard, or unparseable all collapse to `'none'`: the auth UI is not embeddable. `X-Frame-Options` is reconciled in lock-step: `DENY` while framing is locked down, omitted once an allowlist is set. A bare `*` is rejected. |
| `RECAPTCHA_SITE_KEY` | No | unset → no bot gate | reCAPTCHA v3 site key. Public by design: it ships in the page HTML of `/signup`, `/signup/method` and `/recover`. |
| `RECAPTCHA_SECRET_KEY` | With the site key | unset | Secret for Google's `siteverify`. Secret. The gate (`app/server/infra/recaptcha.server.ts`) runs only when both keys are set; otherwise every request passes. A Google outage fails open. |

Two boot checks pair these: a site key without a secret fails startup (the widget would render
and every verification would fail), and so does a secret without `PUBLIC_ORIGIN` (the token
hostname check would silently no-op, and it is the only control against someone farming tokens
with the public site key on another domain).

## Observability

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SENTRY_DSN` | No | unset → disabled | Sentry error monitoring and tracing. Must be a valid `https://` DSN when set: an invalid value fails fast at startup. Unset is a true no-op. |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Fraction of requests sampled for performance tracing (`0.0` to `1.0`). |
| `RYBBIT_SITE_ID` | No | unset → disabled | Rybbit analytics site id. Active in every environment (dev, staging, preview, production) once set, with no server-side environment gating. |
| `RYBBIT_TAG` | No | unset → no `data-tag` | Rybbit `data-tag` cohort-segmentation attribute, e.g. `production` / `staging` / `preview`. |
| `RYBBIT_API_KEY` | No | unset → unauthenticated | Rybbit server-side tracking API key (see `app/modules/analytics/rybbit.server.ts`), used for signup moments that never render an auth-ui page (IdP signups completing mid-OIDC-ceremony). Unauthenticated calls still track, just without bot/domain-spoofing protection. |
| `MAXMIND_ACCOUNT_ID` | No | unset → disabled | MaxMind minFraud device-fingerprinting account id used by the signup device tracker. Optional in every environment. Unset means no `device.js` is loaded and no token is captured. |

## Development

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AUTH_PROVIDER` | No | unset → Zitadel | Provider selector. `fake` selects the in-memory `FakeAuthProvider` (no Zitadel needed). **Any other value, including unset, resolves to the Zitadel adapter**, so the Zitadel requirements above apply. |
| `NODE_ENV` | No | `development` | One of `development`, `production`, `test`. |

`NODE_EXTRA_CA_CERTS` is occasionally needed locally to trust a self-signed Zitadel CA. It is a
Node runtime variable, not part of the app's schema.

## Two things worth knowing

**1. The app fails to boot on bad config.** Validation is `schema.parse(process.env)` at module
load. In production with the Zitadel provider, a missing `ZITADEL_API_URL`,
`ZITADEL_SERVICE_USER_TOKEN`, or `PUBLIC_ORIGIN` aborts startup. So does a `PUBLIC_ORIGIN` that
still contains `REPLACE_ME`. The Kubernetes manifest ships `PUBLIC_ORIGIN=https://REPLACE_ME.example`
as a placeholder, and it is a *valid* URL, so the guard matches the literal marker rather than
trusting the URL check. The message starts with:

```
PUBLIC_ORIGIN is still the deployment placeholder
```

The half-configured mail and reCAPTCHA pairs above fail the same way, in every environment. A
crash-loop on deploy is almost always one of these. See [Troubleshooting](./troubleshooting.md).

**2. `AUTH_EMAIL_VERIFICATION_REQUIRED` defaults on.** An environment that relied on the old
unset-means-off behaviour of `EMAIL_VERIFICATION` must now set
`AUTH_EMAIL_VERIFICATION_REQUIRED=false` explicitly. `.env.example` lists the valid combinations
with `AUTH_EMAIL_DELIVERY_ENABLED`; delivery off with verification on dead-ends every signup.

A related, smaller wrinkle: the schema comment for `FRAME_ANCESTORS` mentions a legacy
`NEXT_PUBLIC_FRAME_ANCESTORS` alias carried over from the old Next.js app. The schema does not
actually read it; only `FRAME_ANCESTORS` has any effect.
