# Architecture Overview

Datum Auth UI is the login experience for Datum Cloud, served at `/id`. It is a server-rendered React Router 7 app behind a Hono BFF, talking to Zitadel v2 APIs through a single swappable provider interface.

## Tech Stack

| Layer         | Choice                                    |
| ------------- | ----------------------------------------- |
| Runtime       | Bun 1.3                                   |
| Framework     | React Router 7 (SSR, framework mode)      |
| BFF           | Hono via `react-router-hono-server`       |
| Identity      | Zitadel v2 APIs (`@zitadel/client`)       |
| UI            | Tailwind CSS v4 + `@datum-cloud/datum-ui` |
| Forms         | Conform + Zod                             |
| i18n          | Lingui 6                                  |
| Testing       | Cypress (component, e2e, acceptance)      |
| Observability | Sentry, prom-client                       |

## Request Path

```text
                    Browser
                       |
                       v
        +------------------------------+
        |   Hono BFF (app/server.ts)   |
        |  secure headers, CSRF,       |
        |  rate limit, legacy redirects|
        +---------------+--------------+
                        |
                        v
        +------------------------------+
        |  React Router 7 (SSR)        |
        |  app/routes/  -> loaders,    |
        |                  actions     |
        +---------------+--------------+
                        |
                        v
        +------------------------------+
        |  app/resources/*             |
        |  server-side services        |
        +---------------+--------------+
                        |
                        v
        +------------------------------+
        |  AuthProvider  (the seam)    |
        |  app/modules/auth/           |
        +---------------+--------------+
                        |
             +----------+-----------+
             v                      v
      Zitadel adapter         Fake adapter
      (providers/zitadel)     (tests, local dev)
             |
             v
        Zitadel v2 APIs
```

The Hono layer in `app/server.ts` owns everything that must run before routing: metrics (`httpMetrics`), request context, secure headers and the CSP nonce, legacy `/ui/v2/login/*` redirects, per-endpoint rate limiting, and the operational endpoints (`/healthz`, `/readyz`, `/metrics`, `/security`). It also serves `/id/sso/saml-post` outside React Router so the auto-submitting SAML form is never processed by a loader.

## Where Things Live

| Directory                                       | Responsibility                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `app/routes/`                                   | Route modules — loaders, actions, and the screens themselves                                                     |
| `app/resources/`                                | Server-side services the routes call (login, signup, sso, mfa, otp, password, session, device, verify, webauthn) |
| `app/modules/auth/`                             | The `AuthProvider` interface, its adapters, and session cookies                                                  |
| `app/modules/`                                  | Other cross-cutting modules — `analytics`, `fraud`, `i18n`                                                       |
| `app/server/`                                   | Hono edge and middleware, env parsing, observability, CSRF                                                       |
| `app/components/`, `app/hooks/`, `app/layouts/` | UI building blocks                                                                                               |
| `app/shared/`, `app/utils/`                     | Leaf helpers with no upward dependencies                                                                         |

## Design Principles

**The provider seam.** Routes and resources depend on one interface — `app/modules/auth/auth-provider.ts` — never on a concrete identity backend. See [Provider Seam](./provider-seam.md).

**Server-side resources.** Business logic lives in `app/resources/*`, not in components. A route module parses input, calls a resource, and renders the outcome. Resources may not import from `app/routes/` (except the pure path constants in `app/routes/paths.ts`) and may not reach into `app/server/edge/`.

**Co-located route modules.** Each ceremony is a directory under `app/routes/` whose files map one-to-one onto URL segments in `app/routes.ts`. Layouts exist only where children genuinely share loader data (`login`, `signup`); the rest were collapsed so the module tree matches the URL tree.

**Fail-closed security defaults.** Every allowlist defaults to "deny": `FRAME_ANCESTORS` unset means `frame-ancestors 'none'`, an unlisted forward host is rejected before it reaches the Zitadel transport, and a post-logout redirect outside `POST_LOGOUT_ALLOWLIST` is not followed. See [Session & Security](./session-and-security.md).

**Enforced boundaries.** The layering above is not a convention — it is checked. `bun run lint:boundaries` runs dependency-cruiser against `.dependency-cruiser.cjs`, and `bun run lint:cycles` runs madge for import cycles.
