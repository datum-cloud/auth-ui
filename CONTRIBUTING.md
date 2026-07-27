# Contributing to auth-ui

Thank you for contributing. This document covers the essentials you need before
opening a pull request.

## Prerequisites

- [Bun](https://bun.sh/) >= 1.3.14
- Node 20+ (managed via `.nvmrc`)
- A running instance of the dev environment — see [Getting Started](docs/getting-started/)

## Local development

```bash
bun install         # install dependencies and wire up lefthook pre-commit hooks
bun run dev         # start the local dev server
```

## Before you push

Run the full local gate:

```bash
bun run lint             # ESLint (auto-fix)
bun run typecheck        # TypeScript + route type generation
bun run lint:boundaries  # architecture fitness — dependency-cruiser
bun run lint:cycles      # circular import check — madge
bun run size             # bundle budget (requires bun run build first)
```

CI runs the same checks. A PR that fails any of these will not be merged.

## Architecture must respect module boundaries

This project enforces a strict module layering contract via
[dependency-cruiser](https://github.com/sverweij/dependency-cruiser). The rules
live in [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs).

**Core constraint:** `app/modules/` sub-directories (`auth`, `analytics`, `fraud`,
`i18n`) are isolated from each other. Cross-module imports are forbidden except
through explicit composition seams defined in `app/server/composition.ts`.

| What is forbidden | Why |
|---|---|
| Importing `app/modules/auth/providers/` from outside `auth/` | Provider implementations are private; use the interface |
| `app/resources/` importing from `app/server/edge/` | Edge utilities must not leak into the resource layer |
| `app/shared/` importing from routes, resources, modules, or server | `shared/` is a leaf — it must not depend on the layers above it |
| `app/resources/` importing from `app/routes/` (except `paths.ts`) | Resources must not couple to route modules |
| Circular imports anywhere | Cycles make dependency graphs unresolvable |

If `bun run lint:boundaries` rejects your import, the fix is to restructure the
code — not to weaken or comment-out the rule. If you believe the rule is
wrong for your use case, open an issue to discuss it first.

See [Architecture Overview](docs/architecture/overview.md) and
[Provider Seam](docs/architecture/provider-seam.md) for the rationale.

## Testing

```bash
bun run test:unit          # Cypress component tests
bun run test:e2e:fast      # E2E suite against the fake auth provider
```

See [Testing](docs/development/testing.md) for the full test strategy.

## Commits and PRs

- Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, etc.)
- Keep PRs focused — one logical change per PR
- All CI jobs must pass before a PR can be merged

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE).
