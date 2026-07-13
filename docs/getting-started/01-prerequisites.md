# Prerequisites

What you need on your machine before cloning `auth-ui`.

## Required

| Tool | Version | Why |
| --- | --- | --- |
| [Bun](https://bun.sh) | 1.3+ (CI and the Docker image pin `1.3.14`) | Runtime and package manager — every script runs through `bun`. |
| [Node.js](https://nodejs.org) | 22 (`.nvmrc`) | Some toolchain binaries (React Router typegen, Cypress) expect a Node runtime on `PATH`. |
| [Git](https://git-scm.com) | any recent | Cloning and hooks (`lefthook` installs on `bun install`). |

Install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

Install Node 22 with your version manager of choice, e.g.:

```bash
nvm install    # reads .nvmrc → 22
nvm use
```

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
bun --version      # 1.3.x
node --version     # v22.x
```

If both print the expected versions, you are ready to configure the environment.

## Next Step

[Environment Setup](./02-environment-setup.md)
