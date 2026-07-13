# 002. Cypress over Vitest

- **Status:** Accepted
- **Date:** 2026-06-26

## Context

The rebuilt app carried two test runners. Vitest owned the unit layer — 1,287 cases across 190 files, run in a jsdom-family DOM emulator. Cypress owned e2e — real server, real browser, real Zitadel.

Two runners meant two of everything: two configs, two mocking models, two sets of helpers, two ways to stub a server-only module, and two mental models a contributor had to hold. It also meant component tests ran in an emulated DOM rather than a browser, and that the Lingui macros the app depends on had to be worked around under Vitest.

The suite was also simply too large to be useful. 1,287 cases is not 1,287 units of confidence; a large fraction were render-only assertions, implementation-detail checks, and exhaustive permutations of utilities nobody was going to break.

The sibling repo `cloud-portal` had already settled this question: no Vitest, Cypress only, with a component project that hosts both mount specs and pure no-mount logic specs.

## Decision

**Cypress is the only test framework. Vitest is removed entirely.**

- `cypress.config.ts` declares two projects: `e2e` (real server) and `component` (`framework: react`, `bundler: vite`).
- The unit layer _is_ the Cypress component project:

  ```bash
  bun run test:unit        # CYPRESS=true cypress run --component
  bun run test:unit:debug  # CYPRESS=true cypress open --component
  ```

- The component project holds two kinds of spec:
  - **mount specs** (`.cy.tsx`) — render React through `mount()` / `mountRemixRoute()`;
  - **no-mount logic specs** (`.cy.ts`) — import a function, assert on its return. No DOM.
- `vite.config.ts` is `CYPRESS`-aware: when `process.env.CYPRESS` is set it drops the React Router and Hono server plugins and neutralizes server-only modules with browser-safe stubs, so specs that transitively pull in `env.server`, cookie session storage, or the Zitadel adapter still bundle.
- The old suite was pruned **risk-based, with no quota**, and re-expressed as Cypress specs. What survived: token/claim mappers, redirect and post-logout allowlists, reauth guards, session cookie scoping, SSO callback identity matching, OTP/MFA challenge logic, CSRF and CSP behaviour. What was cut: render-only assertions, implementation-detail tests, exhaustive permutations, and anything an e2e spec already covered end to end.
- Genuinely node-bound logic (real RFC-6238 TOTP over `node:crypto`) is **not** forced into a browser — it stays validated at the e2e layer, which computes live TOTP in `cypress.config.ts`.

The tree today: 196 component specs and 24 e2e specs, plus a live-Zitadel acceptance spec. No `vitest.config.ts`, no `vitest` dependency, no `app/**/*.test.ts(x)`.

## Rationale

One runner, one config, one mocking model, one set of helpers. The suite that remains is smaller and higher-signal, and the pieces that genuinely need a browser get one. The CI cost of browser-based unit tests is paid down by pruning plus `cypress-split` sharding, not by pretending a jsdom run is the same thing.

Real-browser fidelity for _logic_ tests was explicitly **not** a driver. Most surviving logic specs never mount anything.

## Alternatives Considered

### Keep both runners

- **Pros:** No migration work; jsdom unit tests are fast.
- **Cons:** Two configs, two mocking models, two ways to stub server-only code, permanent contributor overhead; the Lingui-macro workaround stays.
- **Why rejected:** The maintenance cost was the whole problem. Speed alone did not justify it.

### Keep Vitest, drop Cypress component testing, push all UI coverage to e2e

- **Pros:** Also one unit runner; fastest possible unit layer.
- **Cons:** E2E is the most expensive layer to grow; component-level regressions would only be caught by full-flow specs, slowly and with worse failure messages.
- **Why rejected:** It solves duplication by overloading the layer least suited to absorb it.

### Migrate to Vitest browser mode

- **Pros:** Real browser rendering without leaving Vitest.
- **Cons:** Still two frameworks in the repo; diverges from `cloud-portal`, which is the estate's proven pattern.
- **Why rejected:** It buys browser fidelity but not the consolidation that was the actual goal.

## Consequences

**Positive**

- One framework, one config, one set of test helpers (`@testing-library/cypress`, custom `mount` / `mountRemixRoute` commands).
- Component tests render in a real browser; the Lingui-macro problem disappears because specs go through the app's real Vite resolution.
- A smaller, higher-signal suite. Coverage thresholds were dropped along with Vitest — matching `cloud-portal`, which has no coverage gate.

**Negative**

- A browser-based unit suite is slower per case than jsdom.
- Vitest-only idioms (its mocking API, its globals) had to be ported by hand.
- Granular unit coverage of node-bound logic is gone; it is covered at e2e instead. This was an accepted trade, not an oversight.

**Risks & Mitigations**

| Risk                                                                        | Mitigation                                                                                                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A server-only module missing from the stub list breaks the component bundle | The stub plugin is `enforce: 'pre'` and only active under `CYPRESS`; the harness was brought up incrementally on critical specs before the mass migration. |
| Wall-clock time of a browser-based unit suite                               | Risk-based pruning plus `cypress-split` sharding of the e2e regression matrix (`SPLIT` / `SPLIT_INDEX`).                                                   |
| Losing a genuinely valuable test during pruning                             | Pruning policy was explicitly security-first: anything auth-critical was kept by default.                                                                  |

## References

- `package.json` — `test:unit`, `test:unit:debug`, `test:e2e`, `test:acceptance`
- `cypress.config.ts`, `cypress/component/`, `cypress/e2e/`, `cypress/support/`
