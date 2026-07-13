# Session & Security

Every control below defaults to the safe answer. Where a value is unset or unparseable, the app denies rather than permits.

## Sessions

Sessions live in signed cookies under `app/modules/auth/session/`:

| File                                          | Cookie     | Purpose                                                       |
| --------------------------------------------- | ---------- | ------------------------------------------------------------- |
| `app/modules/auth/session/cookie.ts`          | `sessions` | the multi-session list backing `/accounts`                    |
| `app/modules/auth/session/session.ts`         | —          | pure list operations (add, remove, cap, most-recent, lookup)  |
| `app/modules/auth/session/last-used-login.ts` | —          | remembers the last identifier used, to prefill the login form |
| `app/modules/auth/session/reauth-intent.ts`   | —          | short-lived (10 min) intent for a re-auth round trip          |

All of them are signed with `SESSION_SECRET` (HMAC-SHA256). `app/server/infra/env.server.ts` requires it to be at least 32 characters and refuses to boot otherwise:

```
SESSION_SECRET must be at least 32 characters (HMAC-SHA256 key)
```

The session _state_ itself — who is signed in, which factors are satisfied — is held by the identity provider. The cookie carries the session handles, not the credentials.

## CSRF

`app/server/csrf.ts` wraps `remix-utils/csrf/server` with a `csrf` cookie scoped to `path: /id` (so it cannot collide with the legacy app on a different prefix), `httpOnly`, `sameSite: lax`, `secure` in production, signed with `SESSION_SECRET`.

- Loaders call `loaderCsrf(request)` to get a token plus any `Set-Cookie` header.
- Actions call `assertCsrf(request, formData)`, which rejects a bad token with a 403. Only `CSRFError` is converted; anything else is rethrown, so an infrastructure failure is never masked as a CSRF rejection.

## Rate Limiting

`app/server/middleware/rate-limit.ts` defines one limiter per sensitive endpoint — login password, signup, password reset, MFA verify, MFA enrol, LDAP, WebAuthn verify, accounts, and verification-email send — all mounted on `*` in `app/server.ts`. They are mounted on the catch-all rather than on path prefixes because Hono matches paths case-sensitively while React Router does not; each middleware self-guards on a lowercased, normalized pathname instead.

The store is pluggable (`app/server/middleware/rate-limit-store.ts`):

- **Default** — `InMemoryRateLimitStore`, a per-process Map. Counters are **per replica**, so the deployment must run `replicas: 1` (or sticky sessions) in this mode.
- **Shared** — set `RATE_LIMIT_REDIS_URL` to a `redis://` / `rediss://` endpoint to select `RedisRateLimitStore`, a sliding-window adapter that lifts the single-replica constraint.

## Secure Headers and CSP

`app/server/edge/secure-headers.ts` (re-exported by `app/server/middleware/secure-headers.ts`) builds the CSP and installs Hono's `secureHeaders`. A per-request nonce is generated there and threaded into the load context in `app/server.ts` so `<Scripts nonce>` and the SSR stream can use it — no `unsafe-inline` in production.

`FRAME_ANCESTORS` drives clickjacking protection, and it drives CSP and the legacy header **in lock-step**:

| `FRAME_ANCESTORS`                          | `frame-ancestors` | `X-Frame-Options`              |
| ------------------------------------------ | ----------------- | ------------------------------ |
| unset / empty / `*` / `none` / unparseable | `'none'`          | `DENY`                         |
| an explicit origin allowlist               | those origins     | omitted (CSP is authoritative) |

A bare `*` is rejected outright — a wildcard `frame-ancestors` defeats the protection entirely. The default is `'none'`: the auth UI is not embeddable unless an environment explicitly opts in.

## Trusted Forwarding

`x-zitadel-forward-host` decides where the service-user token is sent, so an external caller controlling it is an SSRF. The header is honoured **only** when its value appears in `ZITADEL_TRUSTED_FORWARD_HOSTS` — a fail-closed, comma-separated allowlist parsed in `app/server/infra/env.server.ts` and enforced in `app/server/composition.ts` before the value ever reaches the Zitadel transport. Unset means no forward host is trusted.

## Post-Logout Redirects

`app/resources/session/session-logout.service.ts` validates the post-logout target against `POST_LOGOUT_ALLOWLIST`. A relative path is accepted; an absolute URL is followed only if its origin is on the allowlist. Anything else falls back to the in-app logout success screen. Unset allowlist means no external redirect is possible.

## Fraud Signals

`app/modules/fraud/maxmind-tracker.tsx` loads MaxMind's `device.js` on the signup screens and mirrors the resulting minFraud device-tracking token so it can travel with the signup. It is gated on `MAXMIND_ACCOUNT_ID`; with the variable unset the tracker is a true no-op — no script loaded, no token captured.

This is **Datum-specific**. Fraud screening happens downstream, against the provisioned User resource (see [User Provisioning](./user-provisioning.md)); an external deployment would drop this module or swap in its own signal.

## Error Scrubbing

`app/server/sentry-scrub.ts` is the egress boundary. It is an **allowlist**: a fresh Sentry event is constructed from only the fields known to be safe, and everything else is dropped. No provider or proto type, no login name or identifier, no token, cookie, or request body leaves the process. A denylist would silently leak whatever field the SDK adds next.

Nothing is lost operationally — the raw provider detail stays in the server log keyed by `traceId` (set in `app/server/middleware/request-context.ts`, logged via `app/server/observability.ts`). The `traceId` tag survives scrubbing, so an on-call engineer can pivot from a neutral Sentry event to the full server log line.
