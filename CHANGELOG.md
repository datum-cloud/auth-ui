# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Signing in with an external identity provider (e.g. GitHub) stored the provider's
  own username in the session instead of the Datum login name, so "Add passkey"
  redirected to the login screen and the account picker showed a live session as
  needing re-authentication.
- Adding a sign-in method (passkey, security key, authenticator app, email or SMS
  code) now identifies the account from the active session rather than by name, so
  sessions created before this fix recover without signing in again.

## [0.1.0] — 2026-06-23

First public-release candidate. Covers the enterprise audit-remediation run
(waves W1–W10): the safety-net + governance foundation (W1–W3), the
component/route refactor and god-route split (W4–W7), type & PnP hardening (W8),
error-handling completion (W9), and the perf/UX/a11y finalize gate (W10). All
ten wave gates closed green; auth URLs are byte-frozen across the run.

### Added
- MIT `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
  (Contributor Covenant v2.1), `CODEOWNERS`, and GitHub issue/PR templates
  (enterprise OSS governance).
- Architecture-fitness gate (`dependency-cruiser`/`madge`), v8 coverage with a ratchet
  floor, byte-frozen URL-resolution e2e suite, and a visual-regression baseline.
- `no-console` lint guard; client-bundle size budget (first-load gzip).
- `<BackLink/>` predecessor navigation across the setup and password ceremony
  routes (authenticator, passkey, security-key, email, sms, mfa, password new/change).
- TOTP enrollment QR code (`qrcode.react`) on the authenticator setup screen,
  with the manual secret key retained as a fallback.
- Branding on the login-method screen, consistent with the other branded ceremony
  screens.
- Pluggable rate-limit store interface with an env-gated `ioredis` sliding-window
  adapter (`RATE_LIMIT_REDIS_URL`); the in-memory store remains the default.
- Accessibility regression guards: `axe-core` structural/aria unit tests,
  keyboard focus-order tests, and a `prefers-reduced-motion` test across the
  ceremony components, plus a one-time live `cypress-axe` contrast audit.
- `webauthn-enroll` factory consolidating passkey and security-key enrollment.

### Changed
- CSP `style-src` hardened to a per-request nonce (dropped `'unsafe-inline'`).
- `ALLOW_IDP_UNLINK` now resolved through the validated env schema.
- Error surface consolidated to the single inline `<AuthCeremony error>` banner;
  inline recovery affordances added for expired-session and unsupported-method states.
- Architecture-fitness gate flipped from `warn` to `error` severity (legitimate
  composition/registry/path-constant seams exempted with justification).
- `getLoginSettings`, `/accounts` auth-method lookups, the SSO callback/link RPCs,
  and session create/update were deduped/batched/memoized — fewer calls, identical
  observable output.

### Fixed
- Rate-limit audit logs redact `loginName` via `hashActor` (no raw PII).
- `last-used-login` cookie scoped to `/id`.
- Contextless device-authorization requests (missing `user_code`) now redirect to
  `/device` instead of rendering an error page; stale/expired codes keep the
  tailored recovery screen.
- `sso/link` validates `returnTo` against a same-origin allowlist and uses a
  `Link` to login in place of a GET form.

### Removed
- Unused `@tanstack/react-query` and `@tanstack/react-virtual` dependencies.
