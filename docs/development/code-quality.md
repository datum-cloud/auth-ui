# Code Quality

Five commands make up the local gate. Run them before you push — CI runs the same checks.

```bash
bun run lint             # eslint --fix
bun run typecheck        # react-router typegen && tsc
bun run lint:boundaries  # dependency-cruiser — enforces the provider seam
bun run lint:cycles      # madge — no circular imports
bun run size             # size-limit — 150 KB landing, 300 KB app page (gzip)
```

## Lint and format

```bash
bun run lint       # bunx eslint "app/**/*.{ts,tsx}" --fix
bun run lint:ci    # same, without --fix — what CI runs
bun run format     # bunx prettier --write "**/*.{js,jsx,ts,tsx,json,css,md}"
```

ESLint is flat-config (`eslint.config.mjs`) on `typescript-eslint`. Prettier (`prettier.config.mjs`) sorts imports via `@trivago/prettier-plugin-sort-imports` and orders Tailwind classes via `prettier-plugin-tailwindcss`, so import order and class order are not things you hand-maintain.

## Type checking

```bash
bun run typecheck           # bunx react-router typegen && tsc
bun run typecheck:cypress   # tsc -p cypress/tsconfig.json --noEmit
```

`react-router typegen` regenerates `.react-router/types` (the typed `Route.LoaderArgs`, `Route.ComponentProps`, and friends) — always run `typecheck` rather than bare `tsc`, or the generated types will be stale.

The root `tsconfig.json` excludes `cypress/` entirely, which is why the Cypress specs have their own `cypress/tsconfig.json` and their own `typecheck:cypress` script. Both share the `@/* → app/*` path alias from the root config.

## Boundaries — the provider seam

```bash
bun run lint:boundaries    # depcruise app --config .dependency-cruiser.cjs
```

This is the check that keeps the architecture honest. `.dependency-cruiser.cjs` declares five `error`-severity rules:

| Rule                                 | What it forbids                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `only-composition-imports-providers` | Any import into `app/modules/auth/providers/` from outside that tree, other than `app/server/composition.ts`, `app/modules/auth/select.server.ts`, and test files |
| `resources-not-server-edge`          | `app/resources/` → `app/server/edge/`                                                                                                                             |
| `no-routes-from-resources`           | `app/resources/` → `app/routes/` (except the pure constants in `app/routes/paths.ts`)                                                                             |
| `shared-is-leaf`                     | `app/shared/` → routes, resources, modules, server, or components                                                                                                 |
| `no-circular`                        | Any import cycle                                                                                                                                                  |

If you find yourself wanting to import a Zitadel type into a route, this rule will stop you — and it is right. See [Provider Seam](../architecture/provider-seam.md).

## Cycles

```bash
bun run lint:cycles    # madge --circular --extensions ts,tsx app
```

Redundant with dependency-cruiser's `no-circular`, but madge is faster and prints a readable cycle path, so it is the one to reach for when you are actually untangling something.

## Bundle budgets

```bash
bun run size    # size-limit
```

Needs a `bun run build` first — it measures the real artifacts in `build/client/assets/`. Two budgets, both gzipped, declared in the `size-limit` key of `package.json`:

| Budget              | Limit  |
| ------------------- | ------ |
| landing page (gzip) | 150 KB |
| app page (gzip)     | 300 KB |

> **Note:** a stale `.size-limit.json` also sits in the repo root. size-limit searches `package.json` **before** `.size-limit.json`, so the `package.json` budgets above are the ones that actually run — editing `.size-limit.json` has no effect.

## Pre-commit

`lefthook.yml` runs on staged files, in parallel, on every commit:

| Hook                | Runs                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `eslint`            | `eslint --fix` on staged `*.{js,jsx,ts,tsx}` (auto-staged)                                       |
| `prettier`          | `prettier --write` on staged `*.{js,jsx,ts,tsx,json}` (auto-staged)                              |
| `typecheck`         | `tsc --noEmit`                                                                                   |
| `i18n`              | `lingui extract --clean && lingui compile --typescript`, then stages `app/modules/i18n/locales/` |
| `typecheck:cypress` | `tsc -p cypress/tsconfig.json --noEmit` on staged `cypress/**`                                   |

Both `locales/**` are excluded from the lint and format hooks — the catalogs are generated, not hand-edited. Hooks install via `bun run prepare` (`lefthook install`), which runs automatically on `bun install`.

## Related Documentation

- [Provider Seam](../architecture/provider-seam.md) — the boundary `lint:boundaries` protects
- [Testing](./testing.md) — the four suites
- [Internationalization](./i18n.md) — what the `i18n` pre-commit hook regenerates
- [Project Structure](./project-structure.md) — the layering the rules encode
