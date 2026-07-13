# Provider Seam

The single most important rule in this codebase: **the app does not know it is talking to Zitadel.**

Every identity operation goes through one interface — `AuthProvider`, declared in `app/modules/auth/auth-provider.ts`, with its data shapes in `app/modules/auth/types.ts`. Concrete adapters implement it. Routes and resources never name one.

```text
app/routes/     ──┐
app/resources/  ──┼──> app/modules/auth/auth-provider.ts   (the AuthProvider interface)
                  │              ^
                  │              │  selected at runtime by select.server.ts
                  │    ┌─────────┴──────────┐
                  │    │                    │
                  └──> app/modules/auth/providers/zitadel/   (production adapter)
                       app/modules/auth/providers/fake/      (tests, local dev)
```

## The Rule

Routes and resources import only `app/modules/auth/auth-provider` and its types — **never** `app/modules/auth/providers/zitadel/` directly.

Exactly two sites outside the `providers/` tree are allowed to name a concrete provider:

- `app/modules/auth/select.server.ts` — the provider registry. It maps the `AUTH_PROVIDER` mode (`zitadel` | `fake`) onto an adapter constructor.
- `app/server/composition.ts` — the request-aware composition root. It resolves the Zitadel service URL for the request (honouring the fail-closed `ZITADEL_TRUSTED_FORWARD_HOSTS` allowlist) and hands back an `AuthProvider`. Routes reach it through the neutral `app/server/auth-context.server.ts`.

Test files are the third exemption: `__tests__/` and `*.{test,spec}.{ts,tsx}` may import the fake adapter directly to drive a unit against a deterministic in-process double.

## Enforcement

This is not a convention — it is a lint gate.

```bash
bun run lint:boundaries   # depcruise app --config .dependency-cruiser.cjs
```

The `only-composition-imports-providers` rule in `.dependency-cruiser.cjs` fails the build on any import into `app/modules/auth/providers/` from outside that tree, other than the exemptions above. Three sibling rules keep the rest of the layering honest:

| Rule                        | What it forbids                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `resources-not-server-edge` | `app/resources/` → `app/server/edge/`                                                 |
| `no-routes-from-resources`  | `app/resources/` → `app/routes/` (except the pure constants in `app/routes/paths.ts`) |
| `shared-is-leaf`            | `app/shared/` → routes, resources, modules, server, or components                     |
| `no-circular`               | any import cycle                                                                      |

## Why It Pays

**The whole suite runs without Zitadel.** `app/modules/auth/providers/fake/fake-provider.ts` is a complete in-memory implementation of `AuthProvider` — seeded users, sessions, factors, and IdPs. Set `AUTH_PROVIDER=fake` and the app boots, signs in, enrols MFA, and completes SSO with no identity backend running. Cypress e2e and component suites lean on it; so does local development when you do not want a Zitadel instance.

**The identity backend stays swappable.** All Zitadel-specific surface — the proto types, the gRPC transport, the error mapping, the field mappers — is confined to `app/modules/auth/providers/zitadel/`. Adding a second backend means writing one more adapter and one more registry entry, not touching a single route.

**Errors stay neutral at the boundary.** The Zitadel adapter maps provider errors into the app's own error codes (`app/modules/auth/providers/zitadel/app-error-map.ts`), so provider vocabulary never leaks into the UI — or into Sentry (see [Session & Security](./session-and-security.md)).
