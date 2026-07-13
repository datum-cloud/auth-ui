# Adding a Route

The one rule that shapes everything below: **a route component never calls the provider.** Routes parse a request and render; `app/resources/<domain>/` does the work; `app/modules/auth/` is the only thing that knows Zitadel exists. `bun run lint:boundaries` enforces this, so a shortcut here fails the build rather than shipping.

## 1. Write the route module

Put it under `app/routes/<flow>/` — the directory is the ceremony (`login/`, `signup/`, `password/`, `setup/`, `verify/`, `sso/`, `device/`, `authorize/`, `logout/`).

```tsx
// app/routes/login/backup-code.tsx
import type { Route } from './+types/backup-code';
import { redeemBackupCode } from '@/resources/mfa';
import { paths } from '@/routes/paths';
import { redirect } from 'react-router';

export async function loader({ request }: Route.LoaderArgs) {
  // read what the screen needs — nothing provider-specific
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const result = await redeemBackupCode(request, form); // ← the resource does the work
  if (!result.ok) return { error: result.code };
  return redirect(paths.signedIn);
}

export default function BackupCode({ actionData }: Route.ComponentProps) {
  // render — AuthCard / AuthForm from app/components/
}
```

The `./+types/<name>` import is generated. If your editor cannot resolve it, run `bun run typecheck` (which runs `react-router typegen` first).

## 2. Register it in `app/routes.ts`

Every URL in the app is declared here — there is no file-system routing.

```ts
route('login', 'routes/login/layout.tsx', { id: 'login' }, [
  index('routes/login/index.tsx'),
  route('method', 'routes/login/method.tsx'),
  route('backup-code', 'routes/login/backup-code.tsx'),   // ← new
]),
```

Prefer a URL constant in `app/routes/paths.ts` over a hand-written string at the call sites — it is the one module resources are allowed to import from `routes/`.

## 3. Put the server logic in `app/resources/<domain>/`

Pick the domain, not the screen: `login`, `signup`, `mfa`, `otp`, `password`, `session`, `sso`, `verify`, `webauthn`, `device`, `authorize`. Zod schemas go in the domain's `*.schema.ts` (or `app/resources/schemas/`), and Conform validates the form against them.

The resource is where you call the provider — through the seam:

```ts
// app/resources/mfa/redeem-backup-code.ts
import { providerForRequest } from '@/server/auth-context.server';

export async function redeemBackupCode(request: Request, form: FormData) {
  const provider = providerForRequest(request); // the AuthProvider interface, never a Zitadel client
  // …call it, then map provider errors into the app's own error codes
  // (app/utils/errors/auth-error.ts)
}
```

`providerForRequest` is the neutral boundary every resource uses (`app/server/auth-context.server.ts` re-exports it from the composition root). It hands back the `AuthProvider` interface — which is `zitadel` or `fake` depending on `AUTH_PROVIDER`, and your resource cannot tell the difference. That is the point.

Provider errors must not leak: map them to an `AuthErrorCode` so the UI and Sentry only ever see the app's vocabulary.

## 4. Add a Cypress component spec

Mirror the path. A route at `app/routes/login/backup-code.tsx` gets its spec at `cypress/component/routes/login/backup-code.cy.tsx`. Pure logic in the resource gets a no-mount spec (`.cy.ts`) under `cypress/component/resources/mfa/`.

```bash
bun run test:unit:debug    # interactive, while you iterate
bun run test:unit          # the full component suite
```

## 5. Add an e2e spec if it is user-visible

If a user can reach the screen in a real flow, it needs a spec in `cypress/e2e/` that drives it against a running server with `AUTH_PROVIDER=fake`.

```bash
bun run test:e2e
```

## Checklist

- [ ] Route module added under `app/routes/<flow>/`
- [ ] Registered in `app/routes.ts` (and a constant added to `app/routes/paths.ts` if the URL is referenced elsewhere)
- [ ] All server logic lives in `app/resources/<domain>/` — the component imports no provider code
- [ ] Input validated with a Zod schema through Conform
- [ ] Provider errors mapped to the app's `AuthErrorCode` vocabulary
- [ ] Strings wrapped in Lingui macros (`bun run i18n:extract` picks them up; the pre-commit hook does it for you)
- [ ] Component spec at the mirrored path under `cypress/component/`
- [ ] E2E spec in `cypress/e2e/` if the flow is user-visible
- [ ] `bun run lint && bun run typecheck && bun run lint:boundaries` all clean

## Related Documentation

- [Project Structure](../development/project-structure.md) — what belongs in which layer
- [Provider Seam](../architecture/provider-seam.md) — why step 3 is non-negotiable
- [Auth Flows](../architecture/auth-flows.md) — the ceremonies the `routes/` groups map to
- [Testing](../development/testing.md) — where each kind of test goes
- [Code Quality](../development/code-quality.md) — the boundary rules that will fail you
