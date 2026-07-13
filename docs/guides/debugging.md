# Debugging

Practical entries for the failures you are most likely to hit, and where to look.

## The app refuses to boot

**Symptom:** the process dies immediately on `bun run dev` or `bun run start` with a `ZodError` listing environment variables.

`app/server/infra/env.server.ts` ends with:

```ts
export const env = schema.parse(process.env);
```

That is a **top-level parse** — it throws at module import, so a bad environment kills the process before a single request is served. This is deliberate: fail closed rather than serve a half-configured auth app.

The strict checks only fire when `NODE_ENV=production` **and** `AUTH_PROVIDER` is not `fake`. In that mode `ZITADEL_API_URL`, `ZITADEL_SERVICE_USER_TOKEN`, and `PUBLIC_ORIGIN` are all required. There is also a **`REPLACE_ME` guard**: the Kubernetes manifest ships `PUBLIC_ORIGIN=https://REPLACE_ME.example` as a placeholder, which passes `z.url()` but would send verification and password-reset links to a domain nobody owns. If `PUBLIC_ORIGIN` still contains `REPLACE_ME`, boot fails with _"PUBLIC_ORIGIN is still the deployment placeholder"_.

**Fix:** read the Zod issue paths — they name the exact variables. For local work, `AUTH_PROVIDER=fake` needs none of the Zitadel ones. See [Configuration](../operations/configuration.md).

## `signin_failed` after an IdP round-trip

**Symptom:** you complete sign-in at the IdP, get bounced back, and land on an error page with `signin_failed`.

`signin_failed` is the **generic fallback** — it is what `providerErrorCode()` collapses an unrecognized provider error into. It means "something went wrong in the callback", not any specific cause, so the code itself will not tell you much.

Start at `app/resources/sso/sso-callback.ts` and read the error mapping. The comments there call out the cases that are deliberately mapped to something _more_ specific than the fallback — if you are seeing the generic code, you are on a path that did not get a specific mapping, and the underlying provider error is the thing you want. Check Sentry for the mapped-from error, or add a breakpoint at the mapping site.

Related: `app/resources/authorize/authorize.service.ts` also emits `signin_failed`, and in some cases deliberately self-heals to `/login` (prune the session, re-authenticate) instead of dead-ending. The full code vocabulary lives in `app/utils/errors/auth-error.ts`.

## Rate limits in dev

**Symptom:** repeated login or signup attempts start returning 429 while you are iterating.

The limiters are declared in `app/server/middleware/rate-limit.ts` and mounted in `app/server.ts`. They are per-endpoint fixed windows, keyed by IP (and login name where the body is not in the way):

| Endpoint               | Limit       |
| ---------------------- | ----------- |
| `/login/password`      | 5 / 5 min   |
| `/password/reset`      | 5 / 10 min  |
| `/signup`              | 10 / 10 min |
| `/verify` (email send) | 10 / 10 min |

By default counters live in an **in-process `Map`** (`InMemoryRateLimitStore`), so the simplest way to clear them in dev is to **restart the dev server**. Setting `RATE_LIMIT_REDIS_URL` swaps in the shared Redis sliding-window store instead.

> That in-process default is also an operational constraint, not just a dev quirk: counters are per-replica, so without the shared store the deployment must run `replicas: 1`. The warning banner at the top of `rate-limit.ts` spells this out.

## CSP is blocking an asset

**Symptom:** the browser console reports a Content-Security-Policy violation, or the page renders unstyled and script-less.

The CSP and the rest of the security headers are built in `app/server/edge/secure-headers.ts` (`app/server/middleware/secure-headers.ts` is only a re-export shim kept for existing importers). It is applied in `app/server.ts`:

```ts
app.use('*', appSecureHeaders(isDev, resolveFrameAncestors(env.FRAME_ANCESTORS)));
```

Two things to check:

- **Framing.** `frame-ancestors` defaults to blocking. To embed the app, set `FRAME_ANCESTORS` (the canonical name; `NEXT_PUBLIC_FRAME_ANCESTORS` is a legacy alias from the old Next.js app and loses when both are set). A bare `*` is rejected — list the origins.
- **Scripts.** The policy is nonce-based. Inline script added without the request nonce will be blocked; that is working as intended.

If assets 404 or come back as HTML rather than JS, suspect the `base: '/id/'` config instead of the CSP — see below.

## Assets 404 or the page never hydrates in dev

The app is served under `/id`, and `vite.config.ts` sets `base: '/id/'`. Every dev asset URL therefore carries the `/id` prefix, which means the `reactRouterHonoServer` dev `exclude` patterns have to be mirrored under that base — otherwise the React Router catch-all SSRs an HTML error page in response to a module script request and hydration never happens. Those patterns are in `vite.config.ts`; `react-router.config.ts`'s `basename` must stay in agreement with the Vite `base`.

## A Cypress component test cannot find a module

**Symptom:** `Cannot find module '@/…'` in a spec, or `tsc` errors on a spec that imports app code.

Path aliases come from **one** place: `paths: { "@/*": ["./app/*"] }` in the root `tsconfig.json`.

- **At type-check time,** the root config **excludes `cypress/`**, so specs are typed by `cypress/tsconfig.json` — which `extends: "../tsconfig.json"` and re-includes `../app/**/*`. That inheritance is what gives specs the `@/*` alias. Run `bun run typecheck:cypress` to see these errors in ~2s rather than waiting for CI.
- **At bundle time,** the component runner uses the Vite bundler, and `vite.config.ts` sets `resolve: { tsconfigPaths: true }` — so Vite reads the same alias from the same file.

If an alias resolves in the editor but fails in the runner, check that you launched through `bun run test:unit` (which sets `CYPRESS=true`). That flag is what switches `vite.config.ts` into component mode and installs `stubServerModulesForCypress`, the plugin that stubs server-only modules. Without it, importing a resource that reaches for `process.env` or a Node built-in will blow up in the browser.

For service logic that genuinely cannot run in a browser (cookies, sessions, audit writes), do not fight the bundler — drive it through the Node task harness (`cy.task('callService', …)`, wired in `cypress/support/node/`), which runs it in real Bun.

## Related Documentation

- [Configuration](../operations/configuration.md) — every environment variable
- [Session & Security](../architecture/session-and-security.md) — sessions, CSRF, rate limiting, CSP
- [Testing](../development/testing.md) — the four suites and how they are wired
- [Troubleshooting](../operations/troubleshooting.md) — production symptoms and their causes
- [Auth Flows](../architecture/auth-flows.md) — what the SSO callback is actually doing
