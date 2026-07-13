# Project Structure

Everything the app runs is under `app/`. The layout is by **layer**, not by feature: a route renders, a resource does the work, and a module owns a cross-cutting concern. The import direction between those layers is enforced by `bun run lint:boundaries` (see [Code Quality](./code-quality.md)).

## `app/`

```text
app/
├── components/   presentational auth widgets (auth-card, auth-ceremony, auth-form,
│                 back-link, brand-logo, form-error, identity-badge, idp-icon,
│                 themed-image, webauthn-button, misc)
├── hooks/        React hooks (use-login-context, use-auth-action-error,
│                 use-auth-action-recovery, useSystemTheme)
├── layouts/      blank.layout.tsx, split.layout.tsx
├── modules/      cross-cutting: auth/ (the provider seam), i18n/, analytics/, fraud/
├── resources/    server-side services per domain (authorize, device, login, mfa, otp,
│                 password, schemas, session, signup, sso, verify, webauthn, shared)
├── routes/       React Router route modules, grouped by ceremony
├── server/       Hono BFF: edge/ (secure headers), infra/ (env), middleware/ (rate
│                 limit, redirects, request context), routes/ (saml-post), csrf,
│                 composition, observability
├── shared/       errors, constants
├── styles/       root.css, fonts
└── utils/        error helpers, asset-url
```

Six files sit at the root of `app/` and wire the whole thing together:

| File                                    | Role                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `root.tsx`                              | The React Router root route — document shell, providers, error boundary  |
| `routes.ts`                             | The route table; every URL in the app is registered here                 |
| `server.ts`                             | The Hono server — middleware order, rate limits, CSP, SAML POST endpoint |
| `entry.client.tsx` / `entry.server.tsx` | Hydration and SSR entry points                                           |
| `sentry.client.ts`                      | Client-side Sentry init                                                  |

### `modules/auth/` — the provider seam

The single most important directory. `auth-provider.ts` defines the `AuthProvider` interface; `providers/` holds the concrete adapters (`zitadel/`, `fake/`); `select.server.ts` and `server/composition.ts` are the only two places allowed to name a concrete provider. Nothing else in the tree may import from `providers/` — dependency-cruiser fails the build if it does. See [Provider Seam](../architecture/provider-seam.md).

### `routes/` vs `resources/`

Route modules stay thin: parse the request, call a resource, render. All provider calls, session work, and error mapping live in `app/resources/<domain>/`. A route never talks to Zitadel — it talks to a resource, and the resource talks to the seam.

`app/routes/paths.ts` is the exception to the layering rule: it is a pure typed-path constant module, so resources may import it for redirect targets.

## Sibling trees

```text
config/
├── base/           Kustomize base — deployment, service, http-route, pdb,
│                   prometheus-rules, service-monitor
└── observability/  Grafana dashboard JSON

cypress/
├── component/      the unit layer — mirrors the app/ tree
│                   (components/, hooks/, layouts/, modules/, resources/,
│                    routes/, server/, shared/, utils/, app/)
├── e2e/            full-flow specs against a running dev server
└── support/        mount helpers, commands, and the Node task harness

acceptance/
├── *.acceptance.cy.ts       flows run against a real Zitadel
└── docker-compose.zitadel.yml
```

`cypress/component/` deliberately mirrors `app/`, so the spec for `app/resources/sso/sso-callback.ts` lives at `cypress/component/resources/sso/`. See [Testing](./testing.md).

## Related Documentation

- [Architecture Overview](../architecture/overview.md) — the stack and the request path
- [Provider Seam](../architecture/provider-seam.md) — why routes never import Zitadel
- [Code Quality](./code-quality.md) — the boundary rules that enforce this layout
- [Adding a Route](../guides/adding-a-route.md) — the recipe that follows this structure
