# auth-ui

Custom login UI for [Zitadel](https://zitadel.com), served under the base path `/id`. This is a ground-up rebuild on the Datum stack, replacing the upstream Zitadel login UI with a fully-owned React application.

## Stack

| Layer         | Package                               |
| ------------- | ------------------------------------- |
| Runtime       | Bun 1.3.x                             |
| Framework     | React Router v7 (framework/SSR mode)  |
| BFF           | Hono via `react-router-hono-server`   |
| UI            | Tailwind v4 + `@datum-cloud/datum-ui` |
| i18n          | Lingui 6                              |
| Data fetching | TanStack Query                        |
| Validation    | Zod                                   |
| Unit tests    | Vitest                                |
| E2E tests     | Cypress                               |

## Setup

```bash
bun install
cp .env.example .env   # fill in SESSION_SECRET and ZITADEL_API_URL
bun run dev
```

See `.env.example` for all required variables.

## Commands

| Command                | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| `bun run dev`          | Start dev server (requires `.env`)        |
| `bun run test:unit`    | Run Vitest unit tests                     |
| `bun run test:e2e`     | Start server + run Cypress                |
| `bun run lint`         | ESLint with auto-fix                      |
| `bun run typecheck`    | Generate route types + `tsc`              |
| `bun run i18n:compile` | Compile `.po` catalogs to `.ts` artifacts |
| `bun run build`        | Production build                          |

Full local gate before pushing:

```bash
bun run lint && bun run typecheck && bun run i18n:compile && bun run test:unit && bun run build
```

## Provider-seam rule

Routes and flows import **only** `providers/auth-provider`, never `providers/zitadel` directly.

```
app/routes/   →   providers/auth-provider   (AuthProvider interface)
app/flows/    →   providers/auth-provider
                        ↑
              providers/zitadel (Phase 1 adapter — behind the seam)
```

The Zitadel adapter lives behind this seam so it can be swapped or mocked without touching route logic. `app/session/` is shared infrastructure consumed by the interface layer, not by the adapter.

## Adding a locale

1. Drop a new catalog file at `app/modules/i18n/locales/<code>.po`.
2. Add the locale code to `lingui.config.ts` in the `locales` array.
3. Add the same code to the `SUPPORTED_LOCALES` constant in `app/modules/i18n/lingui.ts`.
4. Run `bun run i18n:compile`.

The compiled `.ts` artifacts (`locales/*.ts`) are gitignored — the Lingui Vite plugin consumes the `.po` files directly at build time.

## Repo layout notes

- `docs/` — rebuild plan specs and session context
- `config/base/` — Kustomize deployment base (Kubernetes manifests)
