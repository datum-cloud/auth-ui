# Contributing to auth-ui

Thanks for contributing to `datum-cloud/auth-ui` — Datum's authentication UI. This
guide gets you from a clean checkout to a green pull request. It is repo-specific:
every command below is the one this project actually runs.

## Prerequisites

- **[Bun](https://bun.sh)** is the package manager and script runner. This repo pins
  its dependency graph in `bun.lock` (Bun's lockfile) — use Bun, not npm/yarn/pnpm, so
  the lock stays authoritative. Bun also runs the dev server and the toolchain
  (`bunx eslint`, `bunx tsc`, `bunx vitest`, `bunx cypress`).
- **An auth provider.** auth-ui talks to an identity provider through a single
  `AuthProvider` adapter selected by the `AUTH_PROVIDER` env var:
  - `AUTH_PROVIDER=fake` — an in-memory provider that seeds its own users
    (e.g. `alice@acme.test` / `hunter2`). **No Zitadel needed.** This is the
    recommended path for local dev and the fast e2e suite.
  - `AUTH_PROVIDER=zitadel` (default when unset) — a real Zitadel Session API
    backend. Requires `ZITADEL_API_URL` and `ZITADEL_SERVICE_USER_TOKEN`, plus
    `PUBLIC_ORIGIN` in production. Only needed if you are changing Zitadel-specific
    behavior.

## Setup (fake-provider quickstart)

```bash
bun install
cp .env.example .env
```

`.env.example` is the documented superset of every env key (it groups them into
*Always required*, *FAKE provider*, *ZITADEL provider*, *Observability*, and
*Analytics & fraud*) and ships **placeholders only** — `.env` is gitignored; never
commit real secrets. For local dev with the fake provider you only need a
`SESSION_SECRET` (generate one with `openssl rand -base64 32`).

Run the app against the fake provider — no Zitadel, no extra config:

```bash
AUTH_PROVIDER=fake bun run dev
```

The dev server comes up on `http://localhost:3000` (health check at `/healthz`).
Sign in with one of the seeded fake users.

## The local gate

### Pre-commit (automatic)

A [lefthook](https://github.com/evilmartians/lefthook) `pre-commit` hook is installed
by the `prepare` script during `bun install`. On every commit it runs, in parallel,
against your **staged** files:

1. **prettier** — `bunx prettier --write` (auto-formats and re-stages).
2. **eslint** — `bunx eslint --fix` (includes the `no-console` rule; do not leave
   `console.*` calls in shipped code, and never log raw PII).
3. **typecheck** — `bunx tsc --noEmit`.
4. **i18n** — re-extracts and compiles the Lingui catalog when `app/**` changes.

If any step fails, the commit is blocked. Fix the issue and re-commit.

### Full gate (run manually before opening a PR)

The pre-commit hook only sees staged files. Before pushing, run the full gate the
way CI does:

```bash
bun run typecheck        # react-router typegen + tsc, whole project
bun run lint:ci          # eslint with no --fix (must be clean, incl. no-console)
bun run test:unit        # vitest run — all unit/integration tests
bun run test:coverage    # vitest --coverage; must stay at/above the ratchet floor
bun run test:e2e:fast    # build + fake-provider Cypress core-signin smoke
bun run lint:boundaries  # dependency-cruiser architecture-fitness check
bun run size             # size-limit first-load JS (gzip) budget
```

Coverage is ratcheted: it may go **up**, never down. If your change lowers coverage
below the current floor, add tests rather than lowering the threshold.

### Running a single test

```bash
# One unit/integration test file (or a directory):
bunx vitest run app/modules/auth/providers/fake/fake-provider.test.ts

# One Cypress e2e spec:
bunx cypress run --spec cypress/e2e/core-signin.cy.ts
```

## Conventions

- **Conventional Commits.** Prefix every commit with a type:
  `feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `perf`.
  Example: `fix(session): scope last-used-login cookie to /id`.
- **Branch from `main`.** Open one PR per logical change.
- **Use the PR template** (`.github/pull_request_template.md`) and fill in the
  checklist.
- **URLs are byte-frozen.** Routes, redirects, and the URL-resolution behavior are
  contractually stable. Do **not** change a route path, redirect target, or
  query-param contract without going through the URL-resolution e2e gate — that suite
  asserts the exact byte-for-byte URLs and will fail on any drift.
- **No new `console.*`** in `app/` code (enforced by lint), and **no raw PII in
  logs** — hash or redact actor identifiers.

## SPDX header policy

New or substantially-rewritten source files **SHOULD** begin with an SPDX identifier
declaring the project license (MIT). For `.ts` / `.tsx` files use the one-line form
as the very first line:

```ts
// SPDX-License-Identifier: MIT
```

A repo-wide header sweep across existing files is tracked as a separate cleanup task;
for now, apply the header to files you create or rewrite.

## Where things live

The app is layered front-to-back: **`app/routes`** are the HTTP entry points (the
byte-frozen URL surface) → **`app/resources`** hold the per-flow loaders, actions, and
Zod schemas (one folder per auth flow: `login`, `signup`, `mfa`, `otp`, `password`,
`webauthn`, `sso`, `session`, …) → **`app/modules`** are the domain modules, where
`modules/auth/providers/{fake,zitadel}` implement the `AuthProvider` adapter boundary
(plus `analytics`, `fraud`, and `i18n`) → the **providers** layer is that adapter
seam the rest of the app depends on instead of any concrete IdP. Server runtime and
boot wiring live in **`app/server/`**, and presentational UI lives in
**`app/components/`**. Cross-layer dependency rules are enforced by
`bun run lint:boundaries`. For the full architecture rationale see
[`docs/audit/2026-06-20/ENTERPRISE-STRUCTURE-BLUEPRINT.md`](docs/audit/2026-06-20/ENTERPRISE-STRUCTURE-BLUEPRINT.md)
and [`docs/audit/2026-06-20/IMPLEMENTATION-DESIGN.md`](docs/audit/2026-06-20/IMPLEMENTATION-DESIGN.md).

## Security

Found a vulnerability? **Do not** open a public issue or PR — follow
[`SECURITY.md`](SECURITY.md) and use GitHub's private vulnerability reporting.

## License

By contributing, you agree your contributions are licensed under the project's
[MIT License](LICENSE).
