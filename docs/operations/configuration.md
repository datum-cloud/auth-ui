# Configuration

Every environment variable the app reads. The schema in `app/server/infra/env.server.ts` is the
single source of truth — it is parsed **once at boot**, so a missing or invalid required variable
**fails the process at startup**, not at first request.

`.env.example` carries the same list inline, grouped under the same headings.

## Required in production

"Production" here means precisely `NODE_ENV=production` **and** `AUTH_PROVIDER` set to anything
other than `fake`. The `superRefine` guard in the schema enforces these three only under that
condition; `SESSION_SECRET` is required in every environment.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SESSION_SECRET` | Always | — | HMAC-SHA256 key for signing session cookies. **Minimum 32 characters** — shorter values fail validation at boot. Generate with `openssl rand -base64 32`. |
| `ZITADEL_API_URL` | Production (Zitadel) | `http://localhost:8080` | Base URL of the Zitadel API. The default only applies outside production. |
| `ZITADEL_SERVICE_USER_TOKEN` | Production (Zitadel) | — | Service-user PAT used for every server-to-server Zitadel call. Secret. |
| `PUBLIC_ORIGIN` | Production (Zitadel) | — | Trusted origin (scheme + host) used to build verification and password-reset email links. Sourced from config — **never** the request `Host` header, which is client-controllable. |

## Zitadel transport

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ZITADEL_TRUSTED_FORWARD_HOSTS` | No | unset → reject all | Comma-separated allowlist of trusted values for the `x-zitadel-forward-host` header. Unset means **every** forward-host override is rejected (fail-closed). |
| `ZITADEL_CUSTOM_REQUEST_HEADERS` | No | unset → no extra headers | Comma-separated `Key:Value` pairs injected on every outbound Zitadel API request (a Connect interceptor). Use when auth-ui reaches Zitadel over an internal address but Zitadel must mint public-facing URLs (OIDC issuer, SAML metadata/ACS, redirect-URI checks). Example: `x-zitadel-public-host:auth.datum.net,x-zitadel-public-proto:https`. |
| `ZITADEL_DEFAULT_ORG_ID` | No | unset → provider default org | Ops pin for the org-first fallback (`resolveOrg`). When set, a login without an explicit `?organization=` (or OIDC org-id scope) uses this org id instead of calling the provider's default-org lookup. See [ADR 005](../architecture/adrs/005-login-org-scoping.md). |

## Feature flags

All five default to **false** (fail-closed). Only the exact string `true` enables them
(`AUTH_EMAIL_DELIVERY_ENABLED` also accepts `1`). See
[ADR 004](../architecture/adrs/004-idp-linking-flags.md) for the three IdP flags.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AUTH_EMAIL_DELIVERY_ENABLED` | No | `false` | Whether email delivery is wired in this environment (email is sent via Datum infra, not Zitadel SMTP — so this is an explicit switch, not auto-detected). Off keeps magic-link sign-in and password reset hidden so the UI never offers a dead-end flow. |
| `EMAIL_VERIFICATION` | No | `false` | Requires email verification on signup. **Read outside the validated schema** — see the known gap below. |
| `ALLOW_IDP_AUTO_LINK` | No | `false` | Auto-links an external IdP identity into an existing same-email account during login/register. Off means a same-email collision is a hard `account-exists` error and the owner must link the IdP from the signed-in `/sso` screen. |
| `ALLOW_IDP_LINK_ANY_EMAIL` | No | `false` | Lets the explicit SSO link ceremony attach a fresh external identity regardless of its email address. Off applies the strict gate: the IdP-verified email must already be owned by the session user. |
| `ALLOW_IDP_UNLINK` | No | `false` | Permits unlinking an identity provider from an account. |

## Routing

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DEFAULT_APP_URL` | No | unset → route default | Fallback post-login destination when the request carries no `?redirect` param. |
| `POST_LOGOUT_ALLOWLIST` | No | unset → same-origin only | Comma-separated allowlist of absolute origins accepted for the OIDC RP-initiated logout `post_logout_redirect` target. Unset means only same-origin relative paths are permitted (fail-closed open-redirect guard). |

## Security

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `FRAME_ANCESTORS` | No | `'none'` | CSP `frame-ancestors` allowlist (space- or comma-separated full origins). Unset, empty, wildcard, or unparseable all collapse to `'none'` — the auth UI is not embeddable. `X-Frame-Options` is reconciled in lock-step: `DENY` while framing is locked down, omitted once an allowlist is set. A bare `*` is rejected. |

## Observability

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SENTRY_DSN` | No | unset → disabled | Sentry error monitoring and tracing. Must be a valid `https://` DSN when set — an invalid value fails fast at startup. Unset is a true no-op. |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Fraction of requests sampled for performance tracing (`0.0`–`1.0`). |
| `FATHOM_ID` | No | unset → disabled | Fathom analytics site id. Exposure to the client is additionally prod-gated server-side, so dev and preview never contact Fathom even when this is set. |
| `MAXMIND_ACCOUNT_ID` | No | unset → disabled | MaxMind minFraud device-fingerprinting account id used by the signup device tracker. Optional in every environment. Unset means no `device.js` is loaded and no token is captured. |

## Development

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AUTH_PROVIDER` | No | unset → Zitadel | Provider selector. `fake` selects the in-memory `FakeAuthProvider` (no Zitadel needed). **Any other value — including unset — resolves to the Zitadel adapter**, so the Zitadel requirements above apply. |
| `NODE_ENV` | No | `development` | One of `development`, `production`, `test`. |

`NODE_EXTRA_CA_CERTS` is occasionally needed locally to trust a self-signed Zitadel CA. It is a
Node runtime variable, not part of the app's schema.

## Two things worth knowing

**1. The app fails to boot on bad config.** Validation is `schema.parse(process.env)` at module
load. In production with the Zitadel provider, a missing `ZITADEL_API_URL`,
`ZITADEL_SERVICE_USER_TOKEN`, or `PUBLIC_ORIGIN` aborts startup. So does a `PUBLIC_ORIGIN` that
still contains `REPLACE_ME` — the Kubernetes manifest ships
`PUBLIC_ORIGIN=https://REPLACE_ME.example` as a placeholder, and it is a *valid* URL, so the guard
matches the literal marker rather than trusting the URL check:

```
PUBLIC_ORIGIN is still the deployment placeholder — set the real public origin
```

A crash-loop on deploy is almost always this. See
[Troubleshooting](./troubleshooting.md).

**2. Known gap — `EMAIL_VERIFICATION` bypasses the schema.** It is read raw from `process.env` in
`app/server/env.ts` (`requireEmailVerification`), not declared in
`app/server/infra/env.server.ts`. It therefore gets no type, no default, and no boot-time
validation — a typo silently means "off". The source file carries a TODO to promote it into the
schema. Every other variable on this page is schema-validated.

A related, smaller wrinkle: the schema comment for `FRAME_ANCESTORS` mentions a legacy
`NEXT_PUBLIC_FRAME_ANCESTORS` alias carried over from the old Next.js app. The schema does not
actually read it — only `FRAME_ANCESTORS` has any effect.
