# Prerequisites

What you need on your machine before cloning `auth-ui`.

## Required

| Tool                          | Version                                                          | Why                                                        |
| ----------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| [Node.js](https://nodejs.org) | 26.13.0 (`.nvmrc`; CI and the Docker image use the same version) | Runtime.                                                   |
| [pnpm](https://pnpm.io)       | 12.23.0 (`packageManager` in `package.json`)                     | Package manager — every script runs through `pnpm`.        |
| [Git](https://git-scm.com)    | any recent                                                       | Cloning and hooks (`lefthook` installs on `pnpm install`). |

Install Node 26.13.0 with your version manager of choice, e.g.:

```bash
nvm install    # reads .nvmrc → 26.13.0
nvm use
```

Node 26 ships without corepack, so install pnpm with npm:

```bash
npm install -g pnpm@12.23.0
```

pnpm runs dependency install scripts only for the packages listed under `allowBuilds` in
`pnpm-workspace.yaml`, and installs no version published less than a day ago.

## An identity backend — or not

The app talks to [Zitadel](https://zitadel.com) over its v2 APIs, but you do **not** need a
Zitadel instance to run it locally. Pick one:

- **Fake provider** (`AUTH_PROVIDER=fake`) — an in-memory `FakeAuthProvider` with seeded users.
  No Zitadel, no network, no credentials. This is the fastest way in and what the fast e2e
  suite uses.
- **A reachable Zitadel instance** — any Zitadel you can hit, plus a service-user PAT. You will
  need `ZITADEL_API_URL` and `ZITADEL_SERVICE_USER_TOKEN`.
- **A local Zitadel** — `acceptance/docker-compose.zitadel.yml` brings up Zitadel + Postgres for
  acceptance work. Requires Docker (with Compose).

## Optional

- **Docker** — only for the local Zitadel stack above and for building the container image.
- **`openssl`** — to generate a `SESSION_SECRET` (ships with macOS and most Linux distros).

## Checkpoint

```bash
node --version     # v26.13.0
```

If it prints the expected version, you are ready to configure the environment.

## Next Step

[Environment Setup](./02-environment-setup.md)
