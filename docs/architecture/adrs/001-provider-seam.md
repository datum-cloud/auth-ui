# 001. Provider seam

- **Status:** Accepted
- **Date:** 2026-06-14

## Context

This app began as a fork of Zitadel's login v2. A fork inherits its parent's assumptions: Zitadel's proto types, its gRPC transport, its error vocabulary, and its idea of what a session is. Left alone, those assumptions spread — into route loaders, into form actions, into the components that render an error. At that point the app is not "an auth UI that happens to use Zitadel", it _is_ Zitadel's UI, and two things become impossible: swapping the identity backend, and running the test suite without a live Zitadel instance.

The rebuild also needed a structure consistent with the rest of the Datum frontend estate (`cloud-portal`, `staff-portal`): a horizontal-layer model of `routes/` · `resources/` · `modules/` · `components/` · `server/`, where domain logic lives in `resources/` and backend integrations live behind a module boundary.

## Decision

**Routes and resources depend only on the `AuthProvider` interface.**

- The interface is declared in `app/modules/auth/auth-provider.ts`, with its data shapes in `app/modules/auth/types.ts`. It speaks the app's own vocabulary — users, sessions, auth methods, IdP links — never Zitadel's.
- Concrete adapters live under `app/modules/auth/providers/`: `zitadel/` (production) and `fake/` (a complete in-memory implementation used by tests and local development).
- The adapter is selected at runtime by `app/modules/auth/select.server.ts`, which maps the `AUTH_PROVIDER` mode onto an adapter constructor. `app/server/composition.ts` is the request-aware composition root; routes reach it through the neutral `app/server/auth-context.server.ts`.
- Zitadel error codes are translated into the app's own codes at the adapter boundary (`app/modules/auth/providers/zitadel/app-error-map.ts`), so provider vocabulary never reaches the UI.

Nothing outside `app/modules/auth/providers/` may import from it, with exactly three exemptions: the registry (`select.server.ts`), the composition root (`app/server/composition.ts`), and test files driving the fake adapter directly.

## Rationale

The seam is what makes the fork survivable. Everything Zitadel-specific — protos, transport, field mappers, error mapping — is confined to one directory, so a second identity backend is one more adapter and one more registry entry, not a rewrite. And because the fake adapter implements the same interface completely, the app boots, signs in, enrols MFA, and completes SSO with no identity backend running at all.

Choosing `modules/auth/providers/` (rather than, say, `strategies/`) also keeps the on-disk vocabulary matching the code's own: the interface is called `AuthProvider`.

## Alternatives Considered

### Import the Zitadel client directly from routes and resources

- **Pros:** Fewer files, no mapping layer, direct access to every field Zitadel returns.
- **Cons:** Zitadel types leak into loaders, actions, and components; no way to run the suite without Zitadel; every backend concern becomes a UI concern.
- **Why rejected:** This is the default state of the fork, and it is exactly what made the fork hard to reason about. It fails the two requirements that mattered most — swappability and a testable app.

### Keep the seam as a convention, documented but unenforced

- **Pros:** Zero tooling cost; the boundary exists on paper immediately.
- **Cons:** Conventions decay under deadline pressure. One `import { ... } from '@/modules/auth/providers/zitadel/...'` in a hurry and the seam is quietly gone; nothing fails.
- **Why rejected:** A boundary that nothing enforces is a boundary that will be crossed. See _Consequences_.

### A generic "identity SDK" abstraction covering every conceivable backend

- **Pros:** Maximally portable in theory.
- **Cons:** Speculative generality — designing for backends we do not have, with capabilities we cannot test.
- **Why rejected:** The interface is shaped by the capabilities the app actually uses, with an explicit `capabilities` flag set for the optional ones (e.g. `externalIdp`). That is enough.

## Consequences

**Positive**

- **The whole suite runs without Zitadel.** `app/modules/auth/providers/fake/fake-provider.ts` is a complete in-memory `AuthProvider` — seeded users, sessions, factors, IdPs. Cypress component and e2e suites lean on it; so does local development.
- **The identity backend stays swappable.** Adding a backend touches no route.
- **Errors stay neutral.** The UI (and Sentry) never sees a Zitadel error code.

**Negative**

- Every provider capability costs a mapping layer: an interface method, a Zitadel implementation, a fake implementation, and a type. Adding a capability is four edits, not one.
- The fake and the real adapter can drift in behaviour. The e2e and live-acceptance suites against a real Zitadel are the only thing that catches it.

**Risks & Mitigations**

| Risk                                                           | Mitigation                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A route or resource imports the Zitadel adapter directly       | `bun run lint:boundaries` (dependency-cruiser). The `only-composition-imports-providers` rule fails the build on any import into `app/modules/auth/providers/` from outside the exemptions. |
| The layering erodes in other directions (cycles, back-imports) | Four sibling rules in `.dependency-cruiser.cjs`: `resources-not-server-edge`, `no-routes-from-resources`, `shared-is-leaf`, `no-circular`.                                                  |
| The fake adapter diverges from Zitadel's real behaviour        | Live-Zitadel acceptance run (`bun run test:acceptance`) gates the real behaviour.                                                                                                           |

## References

- [Provider Seam](../provider-seam.md) — the how, in operational detail
- `app/modules/auth/auth-provider.ts`, `app/modules/auth/select.server.ts`, `app/server/composition.ts`
- `.dependency-cruiser.cjs` — the enforcement rules
