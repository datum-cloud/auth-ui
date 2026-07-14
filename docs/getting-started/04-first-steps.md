# First Steps

You have the app running. Now sign in, run the local gate, and make a change.

## 1. Sign in

With the fake provider (`AUTH_PROVIDER=fake bun run dev`):

1. Open <http://localhost:3000/id/login>.
2. Enter `alice@acme.test`.
3. Enter the password `hunter2`.

You land on the signed-in screen. Other seeded users exercise the other ceremonies —
`totp-user@acme.test` (TOTP), `passkey-user@acme.test` (passkey), `mfa2-user@acme.test` (MFA
picker), `nofactor-user@acme.test` (enrollment) — all with the same password. The full seed is
`app/modules/auth/select.server.ts`.

## 2. Run the local gate

Run this before every push. It is a subset of what CI runs — CI additionally runs
`typecheck:cypress`, `bun run size`, an i18n-freshness check, a supply-chain audit (`bun audit` +
SBOM), and `test:e2e:fast`:

```bash
bun run lint && bun run typecheck && bun run i18n:compile && bun run test:unit && bun run build
```

| Step | What it does |
| --- | --- |
| `lint` | ESLint over `app/**/*.{ts,tsx}` with `--fix`. CI uses the non-mutating `lint:ci`. |
| `typecheck` | `react-router typegen` then `tsc`. |
| `i18n:compile` | Compiles the Lingui catalogs to TypeScript. Generated output is required for the build. |
| `test:unit` | **Cypress component testing** — `CYPRESS=true cypress run --component`. |
| `build` | `react-router build`. |

### `test:unit` is Cypress, not Vitest

The component suite runs in a real browser through Cypress
(`CYPRESS=true cypress run --component`). There is no Vitest in this repo — it is not a
dependency and there is no Vitest config. If you are looking for a "unit test" file, look for
`*.cy.ts(x)` component specs, not `*.test.ts` Vitest specs.

Debug a component spec interactively:

```bash
bun run test:unit:debug     # CYPRESS=true cypress open --component
```

## 3. The other suites

```bash
bun run test:e2e            # full Cypress e2e against `bun run dev`
bun run test:e2e:fast       # built server + fake provider, core sign-in spec only
bun run test:acceptance     # real Zitadel — needs a live instance
```

`test:e2e` and `test:e2e:fast` both wait on `http://localhost:3000/healthz` before starting the
browser. Details in [Testing](../development/testing.md).

## 4. Make your first change

- **Where things live** — [Project Structure](../development/project-structure.md).
- **Add a route** — [Adding a Route](../guides/adding-a-route.md).
- **Quality bars** (boundaries, cycles, bundle budgets) —
  [Code Quality](../development/code-quality.md).
- **Something broke** — [Debugging](../guides/debugging.md).

## Next Step

[Architecture Overview](../architecture/overview.md)
