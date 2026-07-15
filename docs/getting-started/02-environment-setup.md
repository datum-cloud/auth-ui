# Environment Setup

Configuration is read once at boot and validated with Zod
(`app/server/infra/env.server.ts`). An invalid or missing required variable **fails the process
at startup** rather than at first request.

## Create your `.env`

```bash
bun install
cp .env.example .env
```

`.env` is gitignored. Never commit real secrets.

## The four variables that matter

| Variable | Required | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | **Always** | Session-cookie signing key (HMAC-SHA256). Minimum **32 characters** — shorter values fail validation at boot. |
| `ZITADEL_API_URL` | Production with the Zitadel provider | Base URL of the Zitadel API. Defaults to `http://localhost:8080` when unset. |
| `ZITADEL_SERVICE_USER_TOKEN` | Production with the Zitadel provider | Service-user PAT for every server-to-server Zitadel call. Secret. |
| `PUBLIC_ORIGIN` | Production with the Zitadel provider | Trusted origin (scheme + host) used to build verification and password-reset email links. Must come from config, never the request `Host` header. |

"Production with the Zitadel provider" is precisely `NODE_ENV=production` **and**
`AUTH_PROVIDER` set to anything other than `fake`. In development, or with
`AUTH_PROVIDER=fake`, only `SESSION_SECRET` is required.

## Generate a session secret

```bash
openssl rand -base64 32
```

Paste the output into `.env`:

```bash
SESSION_SECRET=<the 44-character base64 string>
```

## The `PUBLIC_ORIGIN` boot guard

The Kubernetes manifest ships `PUBLIC_ORIGIN=https://REPLACE_ME.example` as a placeholder — a
valid URL, so a naive URL check would let it through. The boot guard therefore rejects any
production `PUBLIC_ORIGIN` still containing `REPLACE_ME`:

```
PUBLIC_ORIGIN is still the deployment placeholder — set the real public origin
```

If ops forgets to set the real origin at cutover, the app refuses to start rather than mailing
users verification links pointing at `REPLACE_ME.example`.

## A minimal local `.env`

Fake provider, nothing else needed:

```bash
SESSION_SECRET=<openssl rand -base64 32>
NODE_ENV=development
AUTH_PROVIDER=fake
```

Against a real Zitadel:

```bash
SESSION_SECRET=<openssl rand -base64 32>
NODE_ENV=development
AUTH_PROVIDER=zitadel
ZITADEL_API_URL=https://your-zitadel.example
ZITADEL_SERVICE_USER_TOKEN=<service-user PAT>
PUBLIC_ORIGIN=http://localhost:3000
```

## Everything else

Sentry, Rybbit, MaxMind, IdP link/unlink switches, the forward-host allowlist, the
post-logout allowlist, frame ancestors — all optional, all documented with their defaults and
fail-closed behaviour in **[Configuration](../operations/configuration.md)**. `.env.example`
carries the same list inline.

## Next Step

[Running Locally](./03-running-locally.md)
