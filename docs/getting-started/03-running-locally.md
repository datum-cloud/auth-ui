# Running Locally

The dev server listens on **port 3000** and the app is served under the **`/id` base path**
(`base: '/id/'` in `vite.config.ts`, `basename: '/id/'` in `react-router.config.ts`). So the
sign-in screen is `http://localhost:3000/id/login`, not `http://localhost:3000/login`.

Pick one of three modes.

## Mode 1 — Fake provider (no Zitadel)

The fastest path. An in-memory `FakeAuthProvider` with seeded users; no network calls, no
credentials beyond `SESSION_SECRET`.

```bash
AUTH_PROVIDER=fake bun run dev
```

Seeded users all use the password `hunter2`. Start with `alice@acme.test` (password only);
others exist for MFA, passkey, and LDAP journeys (see `app/modules/auth/select.server.ts`).

Open <http://localhost:3000/id/login>.

## Mode 2 — Against a real Zitadel

Set the four variables from [Environment Setup](./02-environment-setup.md)
(`SESSION_SECRET`, `ZITADEL_API_URL`, `ZITADEL_SERVICE_USER_TOKEN`, `PUBLIC_ORIGIN`) in `.env`,
then:

```bash
bun run dev
```

`AUTH_PROVIDER` unset — or set to anything other than `fake` — selects the Zitadel adapter.

If your Zitadel uses a self-signed certificate, point Node's TLS at its CA:

```bash
NODE_EXTRA_CA_CERTS=/path/to/zitadel-local-ca.pem bun run dev
```

## Mode 3 — A local Zitadel (acceptance work)

`acceptance/docker-compose.zitadel.yml` brings up Zitadel + Postgres on `localhost:8080`:

```bash
docker compose -f acceptance/docker-compose.zitadel.yml up -d
```

It is a skeleton harness — it starts the services, but seeding a service user and an OIDC app is
still manual. Once you have a PAT, point `.env` at it (`ZITADEL_API_URL=http://localhost:8080`)
and run the acceptance spec:

```bash
bun run test:acceptance
```

See [Testing](../development/testing.md) for what the acceptance suite covers.

## Request path

```
  browser
     |
     |  GET http://localhost:3000/id/login
     v
+----------------------------+
|  Hono server (app/server)  |   /healthz  /readyz  /metrics  /security
|  headers, CSRF, rate limit |   (unprefixed operational endpoints)
+-------------+--------------+
              |
              v
+----------------------------+
|  React Router 7 (basename  |   /id/login, /id/verify, /id/signup, ...
|  '/id/', SSR framework)    |
+-------------+--------------+
              |
              v
+----------------------------+
|  AuthProvider seam         |   fake  |  zitadel (v2 APIs)
+----------------------------+
```

## Health check

```bash
curl http://localhost:3000/healthz     # {"status":"ok"}
curl http://localhost:3000/readyz      # {"status":"ready"}
```

These are served by the Hono layer and are **not** under `/id`. The e2e scripts wait on
`/healthz` before running.

## Production-mode run

To exercise the built server instead of the dev server:

```bash
bun run build
bun run start                          # NODE_ENV=production bun ./build/server/index.js
```

With `AUTH_PROVIDER=fake` this works without any Zitadel credentials — that is exactly what
`bun run test:e2e:fast` does.

## Next Step

[First Steps](./04-first-steps.md)
