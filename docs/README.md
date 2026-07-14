# Datum Auth UI Documentation

The login experience for Datum Cloud, served at `/id`. This documentation covers how the app is built, how to run it, and how to operate it.

## 📚 Getting Started

| Document | Description |
| --- | --- |
| [Prerequisites](./getting-started/01-prerequisites.md) | Tools, versions, and access you need before starting |
| [Environment Setup](./getting-started/02-environment-setup.md) | Configure `.env` — the four required variables |
| [Running Locally](./getting-started/03-running-locally.md) | Dev server, the fake provider, and a local Zitadel |
| [First Steps](./getting-started/04-first-steps.md) | Sign in, run the suites, make your first change |

## 🏗️ Architecture

| Document | Description |
| --- | --- |
| [Overview](./architecture/overview.md) | Stack, request path, and design principles |
| [Auth Flows](./architecture/auth-flows.md) | Login, signup, MFA, passkeys, SSO, device, logout |
| [Provider Seam](./architecture/provider-seam.md) | Why routes never import Zitadel directly |
| [Session & Security](./architecture/session-and-security.md) | Sessions, CSRF, rate limiting, CSP, fraud signals |
| [User Provisioning](./architecture/user-provisioning.md) | How a Zitadel user becomes a Datum user |
| [Decision Records](./architecture/adrs/README.md) | ADRs — why the app is built this way |

## 💻 Development

| Document | Description |
| --- | --- |
| [Project Structure](./development/project-structure.md) | What lives where in `app/` |
| [Testing](./development/testing.md) | Component, e2e, and acceptance suites |
| [Code Quality](./development/code-quality.md) | Lint, format, boundaries, cycles, bundle budgets |
| [Internationalization](./development/i18n.md) | Lingui catalogs and adding a locale |

## 📖 Guides

| Document | Description |
| --- | --- |
| [Adding a Route](./guides/adding-a-route.md) | Route module, resource, and test |
| [Adding a Locale](./guides/adding-a-locale.md) | Catalog, config, compile |
| [Debugging](./guides/debugging.md) | Common failures and how to trace them |

## ⚙️ Operations

| Document | Description |
| --- | --- |
| [Configuration](./operations/configuration.md) | Every environment variable |
| [Deployment](./operations/deployment.md) | Kustomize base, artifacts, and release-driven deploys |
| [Observability](./operations/observability.md) | Sentry, metrics, and the Grafana dashboard |
| [Troubleshooting](./operations/troubleshooting.md) | Production symptoms and their causes |

## Tech Stack

| Layer | Choice |
| --- | --- |
| Runtime | Bun 1.3 |
| Framework | React Router 7 (SSR, framework mode) |
| BFF | Hono via `react-router-hono-server` |
| Identity | Zitadel v2 APIs (`@zitadel/client`) |
| UI | Tailwind CSS v4 + `@datum-cloud/datum-ui` |
| Forms | Conform + Zod |
| i18n | Lingui 6 |
| Testing | Cypress (component, e2e, acceptance) |
| Observability | Sentry, prom-client |

## Getting Help

- **Bugs and features** — open an issue on [GitHub](https://github.com/datum-cloud/auth-ui/issues)
- **Security** — see the [Datum security policy](https://github.com/datum-cloud/.github/blob/main/SECURITY.md); do not open a public issue
- **Contributing** — see the [Datum contributing guide](https://github.com/datum-cloud/.github/blob/main/CONTRIBUTING.md)
