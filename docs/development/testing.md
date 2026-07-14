# Testing

**There is no Vitest.** Cypress is the only test framework in the repo, and the Cypress _component_ project **is** the unit layer — it runs specs in a real browser instead of an emulated DOM. That was a deliberate decision; see [ADR 002 — Cypress over Vitest](../architecture/adrs/002-cypress-over-vitest.md).

## The suites

| Suite                      | Command                   | What it covers                                                                   |
| -------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| Component (the unit layer) | `bun run test:unit`       | `cypress/component/` — mirrors the `app/` tree, real browser                     |
| End-to-end                 | `bun run test:e2e`        | `cypress/e2e/` — full flows against the dev server                               |
| E2E (fast)                 | `bun run test:e2e:fast`   | built app + `AUTH_PROVIDER=fake`, single spec                                    |
| Acceptance                 | `bun run test:acceptance` | `acceptance/` — against a real Zitadel (`acceptance/docker-compose.zitadel.yml`) |

Two more scripts are worth knowing:

```bash
bun run test:unit:debug     # cypress open --component — the interactive runner
bun run typecheck:cypress   # tsc -p cypress/tsconfig.json --noEmit (~2s)
```

## Component — the unit layer

```bash
bun run test:unit           # CYPRESS=true cypress run --component
```

`cypress/component/` mirrors `app/` one-for-one, so the spec for `app/resources/sso/sso-callback.ts` lives under `cypress/component/resources/sso/`. The project holds two kinds of spec:

- **mount specs** (`.cy.tsx`) — render a component or route through the mount helpers in `cypress/support/`;
- **no-mount logic specs** (`.cy.ts`) — import a function, assert on its return. No DOM at all. This is where service and mapper logic is covered.

`CYPRESS=true` switches `vite.config.ts` into component mode: it swaps the React Router plugin for plain React and stubs the server-only modules (`cypress/support/vite-cypress-stubs`). Session- and cookie-dependent service logic that cannot run in the browser is driven through a Node task harness (`cy.task('callService', ...)`, wired in `cypress/support/node/`), so it executes in real Bun.

## End-to-end

```bash
bun run test:e2e            # boots `bun run dev`, waits on /healthz, then runs cypress/e2e
```

`start-server-and-test` brings the dev server up on `http://localhost:3000`, waits for the health probe, runs every spec in `cypress/e2e/`, and tears the server down. These are real flows — sign-in, MFA, passkeys, device grant, logout, legacy redirects, plus an accessibility sweep (`a11y-sweep.cy.ts`, via `cypress-axe`).

For a quick signal without the full sweep:

```bash
bun run test:e2e:fast       # bun run build && AUTH_PROVIDER=fake … --spec cypress/e2e/core-signin.cy.ts
```

That one builds the app, serves it in production mode with the fake provider, and runs the core sign-in spec only. It needs no Zitadel and no credentials.

## Acceptance

```bash
bun run test:acceptance     # cypress run --spec acceptance/core-signin.acceptance.cy.ts
```

Acceptance specs run against a **real Zitadel**, not the fake provider. Bring one up first:

```bash
docker compose -f acceptance/docker-compose.zitadel.yml up -d
```

The `test:acceptance` script runs the core sign-in spec only. The directory holds more (`device-grant`, `ldap-signin`, `logout`, `oidc-authorize`, `saml-authorize`, `signup-email`, `signup-passwordless`, `totp-enroll`) — run one directly:

```bash
bunx cypress run --spec acceptance/totp-enroll.acceptance.cy.ts
```

`acceptance/**` is included in the e2e `specPattern` in `cypress.config.ts`, which is what makes that `--spec` path resolve.

## Where a new test goes

| You changed…                                    | Write the test in…                                              |
| ----------------------------------------------- | --------------------------------------------------------------- |
| A pure function, mapper, or schema              | `cypress/component/<mirrored path>/*.cy.ts` (no mount)          |
| A component or a route's rendering              | `cypress/component/<mirrored path>/*.cy.tsx` (mount)            |
| A resource that needs cookies or a session      | `cypress/component/resources/…` via the `callService` Node task |
| A user-visible flow, end to end                 | `cypress/e2e/*.cy.ts`                                           |
| Behavior that depends on real Zitadel semantics | `acceptance/*.acceptance.cy.ts`                                 |

## Related Documentation

- [ADR 002 — Cypress over Vitest](../architecture/adrs/002-cypress-over-vitest.md) — why there is one runner
- [Project Structure](./project-structure.md) — the `app/` tree the component suite mirrors
- [Code Quality](./code-quality.md) — the rest of the local gate
- [Running Locally](../getting-started/03-running-locally.md) — the fake provider and a local Zitadel
